// Mark a conversation read or unread (wherdr's own "seen").
export default defineApi(async (event, b) => {
  if (!PANE_RE.test(b.pane_id || '')) throw new HerdrError('bad_pane', 'Invalid pane')
  return markSeen(b.pane_id, b.read !== false)
})
