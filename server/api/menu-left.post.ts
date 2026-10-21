// A menu left open on the agent's screen hides its input field (see
// lookForLeftMenu): closed with Escape ("close"), then, for "send", the held
// messages are typed at once instead of waiting for the turn's end.
export default defineApi(async (event, b) => {
  if (!PANE_RE.test(b.pane_id || '')) throw new HerdrError('bad_pane', 'Invalid pane')
  if (b.action !== 'close' && b.action !== 'send') throw new HerdrError('bad_action', 'Invalid action')
  return { ok: true, ...(await closeLeftMenu(b.pane_id, b.action === 'send')) }
})
