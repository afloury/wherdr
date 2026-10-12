// "Project" panel of a herdr-projects coordinator: project state (TASKS.md
// and threads), read on opening, then:
//  - light poll every 15 s while the panel is visible (the server
//    only compares the dates of TASKS.md and of the threads folder);
//  - full re-read when an agent of the project changes state.
// Nothing shows without herdr-projects on the machine (`available: false`).
import type { Pane } from '#shared/types'
import type { ProjectBoard } from '#shared/projectBoard'
import type { MemoryFile, ProjectSettings } from '#shared/projectDocs'
import type { InboxItem, RoutineList } from '#shared/projectInbox'
import type { ThreadAction, ThreadDetail } from '#shared/projectThreads'
import { isCoordinator, pickCoordinator, projectOf } from '#shared/projects'

type Reply = ProjectBoard | { same: true, version: string } | { available: false }

export const POLL_MS = 15000
// Last known state per pane: no flicker of the tab when reopening the view.
const known = new Map<string, ProjectBoard | false>()

// Project panel on the right of a coordinator (computer): shown or collapsed,
// for every coordinator, saved on this device.
export const projectSideOpen = ref(readProjectSide())
function readProjectSide() {
  try { return localStorage.getItem('projectSide') !== '0' }
  catch { return true }
}
export function setProjectSideOpen(v: boolean) {
  projectSideOpen.value = v
  try { localStorage.setItem('projectSide', v ? '1' : '0') }
  catch { /* storage unavailable */ }
  haptic()
}

// Coordinator of a pane's project: the pane itself, otherwise the project's
// coordinator on the same machine, otherwise on another one (threads on a
// machine coordinated from elsewhere). null: not in a project, or no coordinator.
export function projectCoordinatorOf(p: Pane): Pane | null {
  if (isCoordinator(p)) return p
  const slug = projectOf(p)
  return slug ? pickCoordinator(herdrState.value.panes, slug, p.machine || '') : null
}

// The Project panel of a pane's project: its coordinator, panel shown (right-hand
// column on a computer, Project tab on the phone). `toggle` (Mod+Alt+P): on the
// coordinator whose panel is shown, collapse it. False: no coordinator.
export function openProjectPanel(p: Pane, toggle = false): boolean {
  const c = projectCoordinatorOf(p)
  if (!c) return false
  if (desk.value) setProjectSideOpen(!(toggle && c.id === curPane.value && projectSideOpen.value))
  else setPaneViewMode(c.id, 'project')
  if (c.id !== curPane.value) navigateTo(panePath(c.id))
  return true
}

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

// One thread's record and Next list (`herdr-projects thread show`), read on demand.
export function fetchThreadDetail(paneId: string, id: string) {
  return api<{ thread: ThreadDetail }>(`/api/project/thread?pane=${encodeURIComponent(paneId)}&id=${encodeURIComponent(id)}`)
}

// An action on a thread, run by herdr-projects on the coordinator's machine.
export function runThreadAction(paneId: string, id: string, action: ThreadAction) {
  return api<{ output: string }>('/api/project/thread', { pane_id: paneId, id, action })
}

// Unhandled inbox items of the project, and "handled" on one of them.
export function fetchProjectInbox(paneId: string) {
  return api<{ items: InboxItem[], total: number }>(`/api/project/inbox?pane=${encodeURIComponent(paneId)}`)
}
export function markInboxDone(paneId: string, id: string) {
  return api<{ ok: true }>('/api/project/inbox', { pane_id: paneId, id })
}

// Routines of the project (read-only).
export function fetchProjectRoutines(paneId: string) {
  return api<RoutineList>(`/api/project/routines?pane=${encodeURIComponent(paneId)}`)
}

// Settings and memory of the project (read-only).
export function fetchProjectSettings(paneId: string) {
  return api<{ settings: ProjectSettings }>(`/api/project/settings?pane=${encodeURIComponent(paneId)}`)
}
export function fetchProjectMemory(paneId: string) {
  return api<{ files: MemoryFile[] }>(`/api/project/memory?pane=${encodeURIComponent(paneId)}`)
}
export function fetchMemoryFile(paneId: string, name: string) {
  return api<{ name: string, text: string, truncated: boolean }>(`/api/project/memory?pane=${encodeURIComponent(paneId)}&name=${encodeURIComponent(name)}`)
}
