// Cancel a queued message: removed from the agent's queue, its text
// comes back into the phone's input field.
export default defineApi(async (event, b) => {
  if (!PANE_RE.test(b.pane_id || '')) throw new HerdrError('bad_pane', 'Invalid pane')
  const text = String(b.text || '')
  if (!text.trim()) throw new HerdrError('empty', 'Empty message')
  return { ok: true, ...(await cancelQueued(b.pane_id, text, typeof b.id === 'string' ? b.id : undefined)) }
})
