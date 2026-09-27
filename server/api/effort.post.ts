export default defineApi(async (event, b) => {
  if (!PANE_RE.test(b.pane_id || '')) throw new HerdrError('bad_pane', 'pane invalide')
  const model = await setEffort(b.pane_id, String(b.level || ''))
  const p = findPane(b.pane_id)
  if (p) refreshModel(p)
  return { ok: true, model }
})
