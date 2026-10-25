// The Board's data (BoardView): herdr-projects 1.x tasks of every machine from
// GET /api/tasks, read again every 15 s while the page is shown (the server
// answers `same` when nothing changed) and right after an action.
// The last board is kept at module level: the view reopens at once with it;
// `reads` counts the reads that answered since then, so what must not trust
// that kept board (a push that opens a task) waits for a fresh one.
import type { TasksBoard, TasksReply } from '#shared/projectsTasks'

const POLL_MS = 15000
let lastBoard: TasksBoard | null = null
// The last board read, from here or by a task's sheet (its "Start after…"
// picker and the names of the tasks it waits for).
export const seenTasksBoard = shallowRef<TasksBoard | null>(null)
export function sawTasksBoard(b: TasksBoard) { lastBoard = b; seenTasksBoard.value = b }

export function useTasksBoard() {
  const board = shallowRef<TasksBoard | null>(lastBoard)
  const error = ref('')
  const reads = ref(0)
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
      if (!('same' in r)) { board.value = r; sawTasksBoard(r) }
      reads.value++
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

  return { board, error, reads, reload: () => load(true) }
}
