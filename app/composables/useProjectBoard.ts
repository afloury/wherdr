// "Project" panel of a herdr-projects coordinator: project state (TASKS.md
// and threads), read on opening, then:
//  - light poll every 15 s while the panel is visible (the server
//    only compares the dates of TASKS.md and of the threads folder);
//  - full re-read when an agent of the project changes state.
// Nothing shows without herdr-projects on the machine (`available: false`).
import type { Pane } from '#shared/types'
import type { ProjectBoard } from '#shared/projectBoard'
import { isCoordinator, projectOf } from '#shared/projects'

type Reply = ProjectBoard | { same: true, version: string } | { available: false }

const POLL_MS = 15000
// Last known state per pane: no flicker of the tab when reopening the view.
const known = new Map<string, ProjectBoard | false>()

export function useProjectBoard(paneId: () => string, visible: () => boolean) {
  const pane = computed<Pane | undefined>(() => herdrState.value.panes.find(p => p.id === paneId()))
  const coordinator = computed(() => Boolean(pane.value && isCoordinator(pane.value)))
  const cached = known.get(paneId())
  const board = shallowRef<ProjectBoard | null>(cached || null)
  const available = ref(cached === undefined ? null as boolean | null : Boolean(cached))
  const loading = ref(false)
  const error = ref('')
  let seq = 0

  async function load(full = false) {
    if (!coordinator.value || offlineView.value) return
    const id = ++seq
    loading.value = true
    try {
      const since = !full && board.value ? `&since=${encodeURIComponent(board.value.version)}` : ''
      const r = await api<Reply>(`/api/project?pane=${encodeURIComponent(paneId())}${since}`)
      if (id !== seq) return
      error.value = ''
      if ('available' in r) {
        available.value = false
        board.value = null
        known.set(paneId(), false)
      } else if (!('same' in r)) {
        available.value = true
        board.value = r
        known.set(paneId(), r)
      }
    } catch (e) {
      if (id !== seq) return
      error.value = (e as Error).message
      // First read failed (server starting, pane not yet known to
      // it): quick retry instead of waiting for the next poll.
      if (available.value === null && !retry) retry = setTimeout(() => { retry = null; load() }, 3000)
    } finally {
      if (id === seq) loading.value = false
    }
  }

  // Project agents: their state changes (thread finishing, waiting) -> re-read.
  const projectStates = computed(() => {
    const slug = pane.value && projectOf(pane.value)?.toLowerCase()
    if (!slug) return ''
    return herdrState.value.panes
      .filter(p => p.id !== paneId() && projectOf(p)?.toLowerCase() === slug)
      .map(p => `${p.id}=${p.status}`).sort().join(',')
  })
  let stateTimer: ReturnType<typeof setTimeout> | null = null
  watch(projectStates, (now, before) => {
    if (!before || !available.value) return
    if (stateTimer) clearTimeout(stateTimer)
    // herdr-projects sees the new state on its next pass: we give it a moment.
    stateTimer = setTimeout(() => { if (visible()) load(true) }, 2500)
  })

  let poll: ReturnType<typeof setInterval> | null = null
  let retry: ReturnType<typeof setTimeout> | null = null
  function stopPoll() {
    if (poll) clearInterval(poll)
    if (retry) clearTimeout(retry)
    poll = null
    retry = null
  }
  // Decision re-evaluated on each state arrival (pane known, switch from offline
  // to live, panel shown): never frozen at mount.
  const mode = computed(() => refreshMode({
    coordinator: coordinator.value,
    offline: offlineView.value,
    visible: visible(),
    pageVisible: pageVisible.value,
    available: available.value,
  }))
  watch(mode, (m) => {
    stopPoll()
    if (m === 'none') return
    load()
    if (m === 'poll') poll = setInterval(() => load(), POLL_MS)
  }, { immediate: true })

  onUnmounted(() => {
    seq++
    stopPoll()
    if (stateTimer) clearTimeout(stateTimer)
  })

  return { board, available, loading, error, reload: () => load(true), coordinator }
}

// Report of a thread (Markdown), read on demand.
export function fetchThreadReport(paneId: string, id: string) {
  return api<{ id: string, text: string, truncated: boolean }>(`/api/project/report?pane=${encodeURIComponent(paneId)}&id=${encodeURIComponent(id)}`)
}
