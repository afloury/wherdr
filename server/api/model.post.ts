// Changer le modèle d'un agent au repos, pour cette session seulement (jamais
// comme défaut global : cf. server/utils/modelctl.ts).
export default defineApi(async (event, b) => {
  if (!PANE_RE.test(b.pane_id || '')) throw new HerdrError('bad_pane', 'pane invalide')
  const model = await setModel(b.pane_id, String(b.label || ''))
  const p = findPane(b.pane_id)
  if (p) refreshModel(p)
  return { ok: true, model }
})
