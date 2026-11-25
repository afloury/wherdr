// Ticks the user puts on the task lists of an agent's messages (shared/checklist.ts),
// kept on the server per conversation (POST /api/checklist) so they survive a reload and
// follow the user across devices. Ticking sends nothing: the ticks join the next message
// the user writes (Composer.vue). The state outlives the views, one per pane; it is
// polled while any consumer is mounted.
import { applySent, applyToggle, checklistBlock, checklistCounts } from '#shared/checklist'
import type { ChecklistItem, ChecklistMark, ChecklistState } from '#shared/checklist'

const POLL_MS = 5000

interface PaneChecklist {
  state: Ref<ChecklistState>
  // Writes not yet answered: a poll arriving meanwhile would undo the optimistic change.
  inflight: number
  users: number
}
const panes = new Map<string, PaneChecklist>()
let timer: ReturnType<typeof setInterval> | null = null
let listening = false

function entry(paneId: string): PaneChecklist {
  let e = panes.get(paneId)
  if (!e) {
    e = { state: ref<ChecklistState>({}), inflight: 0, users: 0 }
    panes.set(paneId, e)
  }
  return e
}

async function refresh(paneId: string) {
  const e = entry(paneId)
  if (e.inflight > 0) return
  try {
    const r = await api<{ state?: ChecklistState }>(`/api/checklist?pane_id=${encodeURIComponent(paneId)}`)
    if (e.inflight === 0 && r.state) e.state.value = r.state
  } catch { /* offline: the next poll tries again */ }
}

function refreshAll() {
  for (const [id, e] of panes) if (e.users > 0) void refresh(id)
}

function onVisible() {
  if (document.visibilityState === 'visible') refreshAll()
}

function start() {
  if (timer || !import.meta.client) return
  timer = setInterval(refreshAll, POLL_MS)
  if (!listening) {
    document.addEventListener('visibilitychange', onVisible)
    listening = true
  }
}

function stop() {
  if ([...panes.values()].some(e => e.users > 0)) return
  if (timer) clearInterval(timer)
  timer = null
  if (listening) document.removeEventListener('visibilitychange', onVisible)
  listening = false
}

async function write(e: PaneChecklist, paneId: string, body: Record<string, unknown>) {
  e.inflight++
  try {
    const r = await api<{ state?: ChecklistState }>('/api/checklist', { pane_id: paneId, ...body })
    if (e.inflight === 1 && r.state) e.state.value = r.state
  } catch { /* the next poll brings the server's state back */ }
  finally { e.inflight-- }
}

export function useChecklist(paneId: string) {
  const e = entry(paneId)
  if (getCurrentInstance()) {
    onMounted(() => {
      e.users++
      start()
      void refresh(paneId)
    })
    onBeforeUnmount(() => {
      e.users--
      stop()
    })
  }
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
