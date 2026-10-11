// Global Board data (BoardView): every project's board from GET /api/board, then
//  - light poll every 15 s while the view is shown (the server answers `same` when
//    nothing changed);
//  - the projects whose agents changed state are re-read in full after a moment.
// The last board is kept at module level: the view reopens at once with it.
// Agent cards come from the live state, not from the poll.
import { type GlobalBoard, type GlobalBoardReply, buildGlobalBoard } from '#shared/globalBoard'
import { projectOf } from '#shared/projects'
import { POLL_MS } from './useProjectBoard'
import { pruneSent } from './useCoordinatorSend'
import { refreshMode } from '~/utils/projectRefresh'

let lastBoard: GlobalBoard | null = null

export function useGlobalBoard() {
  const board = shallowRef<GlobalBoard | null>(lastBoard)
  const error = ref('')
  let seq = 0
  let stopped = false
  let retry: ReturnType<typeof setTimeout> | undefined

  async function load(refresh: string[] = []) {
    if (offlineView.value || stopped) return
    const id = ++seq
    try {
      // One `refresh` per project key: a folder path may hold any character.
      const query = new URLSearchParams()
      if (board.value) query.set('since', board.value.version)
      for (const key of refresh) query.append('refresh', key)
      const r = await api<GlobalBoardReply>(`/api/board?${query}`)
      if (id !== seq) return
      error.value = ''
      if ('same' in r) return
      board.value = lastBoard = r
      // A task the coordinator moved or removed is no longer "Sent".
      for (const p of r.projects) if (p.board) for (const pane of p.panes) pruneSent(pane, p.board)
    } catch (e) {
      if (id !== seq) return
      error.value = (e as Error).message
      // First read failed (server starting): one quick retry instead of waiting for the poll.
      if (!board.value && !retry) retry = setTimeout(() => { retry = undefined; load() }, 3000)
    }
  }

  // Agents of a project: their state changes (thread finishing, waiting) -> re-read it.
  const states = computed(() => {
    const bySlug: Record<string, string[]> = {}
    for (const p of herdrState.value.panes) {
      const slug = projectOf(p)?.toLowerCase()
      if (slug) (bySlug[slug] ||= []).push(`${p.id}=${p.status}`)
    }
    return Object.fromEntries(Object.entries(bySlug).map(([slug, s]) => [slug, s.sort().join(',')]))
  })
  const changed = new Set<string>()
  let stateTimer: ReturnType<typeof setTimeout> | undefined
  watch(states, (now, before) => {
    for (const slug of new Set([...Object.keys(now), ...Object.keys(before)])) if (now[slug] !== before[slug]) changed.add(slug)
    if (!changed.size) return
    clearTimeout(stateTimer)
    // herdr-projects sees the new state on its next pass: we give it a moment.
    stateTimer = setTimeout(() => {
      const keys = (board.value?.projects || []).filter(p => changed.has(p.slug.toLowerCase())).map(p => p.key)
      changed.clear()
      // No known project for that slug (a new coordinator): a plain read finds it.
      load(keys)
    }, 2500)
  })

  let poll: ReturnType<typeof setInterval> | undefined
  function stopPoll() {
    clearInterval(poll)
    clearTimeout(retry)
  }
  // Re-evaluated when the connection or the page visibility changes: never frozen at mount.
  const mode = computed(() => refreshMode({
    coordinator: true,
    offline: offlineView.value,
    visible: true,
    pageVisible: pageVisible.value,
    available: true,
  }))
  watch(mode, (m) => {
    stopPoll()
    if (m === 'none') return
    load()
    poll = setInterval(() => load(), POLL_MS)
  }, { immediate: true })

  onUnmounted(() => {
    stopped = true
    seq++
    stopPoll()
    clearTimeout(stateTimer)
  })

  // Cards follow the live state (agents come and go between two reads).
  const cards = computed(() => buildGlobalBoard(board.value?.projects ?? null, herdrState.value.panes))

  return { board, cards, error }
}
