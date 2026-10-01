// Retry a message that could not be sent: held again, delivered as soon as
// the agent's input field is visible.
export default defineApi(async (event, b) => {
  if (!PANE_RE.test(b.pane_id || '')) throw new HerdrError('bad_pane', 'pane invalide')
  if (typeof b.id !== 'string' || !b.id) throw new HerdrError('bad_id', 'message invalide')
  return { ok: true, queued: retryQueued(b.pane_id, b.id) }
})
