// Clearing a terminal draft requires an explicit action on a held message.
export default defineApi(async (_event, b) => {
  if (!PANE_RE.test(b.pane_id || '')) throw new HerdrError('bad_pane', 'Invalid pane')
  if (typeof b.id !== 'string' || !b.id) throw new HerdrError('bad_id', 'Invalid message')
  if (typeof b.input_text !== 'string') throw new HerdrError('stale', 'Agent input changed')
  await clearQueuedInput(b.pane_id, b.id, b.input_text)
  return { ok: true }
})
