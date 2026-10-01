// Change the model of an idle agent, for this session only (never
// as the global default: see server/utils/modelctl.ts).
export default defineApi(async (event, b) => {
  if (!PANE_RE.test(b.pane_id || '')) throw new HerdrError('bad_pane', 'pane invalide')
  const model = await setModel(b.pane_id, String(b.label || ''))
  const p = findPane(b.pane_id)
  if (p) refreshModel(p)
  return { ok: true, model }
})
