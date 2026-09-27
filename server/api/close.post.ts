export default defineApi(async (event, b) => {
  if (!PANE_RE.test(b.pane_id || '')) throw new HerdrError('bad_pane', 'pane invalide')
  await herdr('pane.close', { pane_id: b.pane_id })
  poll()
  return { ok: true }
})
