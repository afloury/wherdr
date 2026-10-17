// The Board's data (BoardView): herdr-projects 1.x tasks of every machine from
// GET /api/tasks, read again every 15 s while the page is shown (the server
// answers `same` when nothing changed) and right after an action.
// The last board is kept at module level: the view reopens at once with it.
import type { TasksBoard, TasksReply } from '#shared/projectsTasks'

const POLL_MS = 15000
let lastBoard: TasksBoard | null = null

export function useTasksBoard() {
  const board = shallowRef<TasksBoard | null>(lastBoard)
  const error = ref('')
  let seq = 0
  let stopped = false

  async function load(fresh = false) {
    if (stopped || offlineView.value) return
    const id = ++seq
    try {
      const since = !fresh && board.value ? `?since=${encodeURIComponent(board.value.version)}` : ''
      const r = await api<TasksReply>(`/api/tasks${since}`)
      if (id !== seq) return
      error.value = ''
      if ('same' in r) return
      board.value = lastBoard = r
    } catch (e) {
      if (id === seq) error.value = (e as Error).message
    }
  }

  let poll: ReturnType<typeof setInterval> | undefined
  onMounted(() => {
    load()
    poll = setInterval(() => { if (document.visibilityState === 'visible') load() }, POLL_MS)
  })
  onBeforeUnmount(() => {
    stopped = true
    clearInterval(poll)
  })
  // Back on the page: at once rather than at the next tick.
  watch(pageVisible, (v) => { if (v) load() })

  return { board, error, reload: () => load(true) }
}
