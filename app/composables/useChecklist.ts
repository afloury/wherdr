// Ticks the user puts on the task lists of an agent's messages (shared/checklist.ts),
// kept on the server per conversation (POST /api/checklist) so they survive a reload and
// follow the user across devices. Ticking sends nothing: the ticks join the next message
// the user writes (Composer.vue). The state outlives the views, one per pane: it is read
// once when a view needs it, and polled only by the conversation on screen
// (useChecklistSync, ChatView.vue) while shouldPollChecklist says so.
import { applySent, applyToggle, checklistBlock, checklistCounts, shouldPollChecklist } from '#shared/checklist'
import type { ChecklistItem, ChecklistMark, ChecklistState } from '#shared/checklist'
import { pageVisible } from './useHerdr'

const POLL_MS = 5000

interface PaneChecklist {
  state: Ref<ChecklistState>
  // Writes not yet answered: a poll arriving meanwhile would undo the optimistic change.
  inflight: number
  reading: Promise<void> | null
  loaded: boolean
}
const panes = new Map<string, PaneChecklist>()

function entry(paneId: string): PaneChecklist {
  let e = panes.get(paneId)
  if (!e) {
    e = { state: ref<ChecklistState>({}), inflight: 0, reading: null, loaded: false }
    panes.set(paneId, e)
  }
  return e
}

// One read at a time per pane: the views that mount together share it.
function refresh(paneId: string): Promise<void> {
  const e = entry(paneId)
  if (e.inflight > 0) return Promise.resolve()
  e.reading ??= (async () => {
    try {
      const r = await api<{ state?: ChecklistState }>(`/api/checklist?pane_id=${encodeURIComponent(paneId)}`)
      if (e.inflight === 0 && r.state) e.state.value = r.state
      e.loaded = true
    } catch { /* offline: the next read tries again */ }
    finally { e.reading = null }
  })()
  return e.reading
}

async function write(e: PaneChecklist, paneId: string, body: Record<string, unknown>) {
  e.inflight++
  try {
    const r = await api<{ state?: ChecklistState }>('/api/checklist', { pane_id: paneId, ...body })
    if (e.inflight === 1 && r.state) e.state.value = r.state
  } catch { /* the next read brings the server's state back */ }
  finally { e.inflight-- }
}

export function useChecklist(paneId: string) {
  const e = entry(paneId)
  if (getCurrentInstance()) onMounted(() => { if (!e.loaded) void refresh(paneId) })
  const counts = computed(() => checklistCounts(e.state.value))
  function toggle(key: string, msg: { at: number, items: ChecklistItem[] }, index: number, checked: boolean) {
    e.state.value = applyToggle(e.state.value, key, msg, index, checked)
    void write(e, paneId, { op: 'toggle', key, at: msg.at, items: msg.items, index, checked })
  }
  const takeBlock = () => checklistBlock(e.state.value, fmtTime)
  function confirmSent(marks: ChecklistMark[]) {
    if (!marks.length) return
    e.state.value = applySent(e.state.value, marks)
    void write(e, paneId, { op: 'sent', marks })
  }
  function discard() {
    const block = takeBlock()
    if (block) confirmSent(block.marks)
  }
  return { state: e.state, toggle, counts, takeBlock, confirmSent, discard }
}

// The conversation on screen (ChatView.vue): read when it opens and when the page comes
// back, then every few seconds only while the page is visible and a recent reply holds a
// task list or ticks wait to be sent. `recent`: a task list in the last agent replies.
export function useChecklistSync(paneId: () => string, recent: () => boolean) {
  const mounted = ref(false)
  let timer: ReturnType<typeof setInterval> | null = null
  const halt = () => {
    if (timer) clearInterval(timer)
    timer = null
  }
  const polling = computed(() => shouldPollChecklist({
    onScreen: mounted.value,
    visible: pageVisible.value,
    recent: recent(),
    unsent: checklistCounts(entry(paneId()).state.value).changed > 0,
  }))
  watch([polling, paneId], ([on]) => {
    halt()
    if (on) timer = setInterval(() => void refresh(paneId()), POLL_MS)
  })
  watch(paneId, id => void refresh(id))
  watch(pageVisible, (v) => { if (v && mounted.value) void refresh(paneId()) })
  onMounted(() => {
    mounted.value = true
    void refresh(paneId())
  })
  onBeforeUnmount(() => {
    mounted.value = false
    halt()
  })
}
