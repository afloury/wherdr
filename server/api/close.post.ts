export default defineApi(async (event, b) => {
  if (!PANE_RE.test(b.pane_id || '')) throw new HerdrError('bad_pane', 'pane invalide')
  if (b.close_group === true) {
    await herdr('workspace.close', { workspace_id: String(b.pane_id).split(':')[0], close_group: true })
  } else await herdr('pane.close', { pane_id: b.pane_id })
  poll()
  return { ok: true }
})
