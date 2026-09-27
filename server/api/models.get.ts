// Modèles proposés par le menu /model de l'agent (lu une fois par type d'agent,
// puis gardé en cache ; `refresh=1` pour relire).
export default defineApi(async (event) => {
  const q = getQuery(event)
  const pane = String(q.pane || '')
  if (!PANE_RE.test(pane)) throw new HerdrError('bad_pane', 'pane invalide')
  return listModels(pane, q.refresh === '1')
})
