// Models offered by the agent's /model menu (read once per agent kind,
// then cached; `refresh=1` to re-read).
export default defineApi(async (event) => {
  const q = getQuery(event)
  const pane = String(q.pane || '')
  if (!PANE_RE.test(pane)) throw new HerdrError('bad_pane', 'pane invalide')
  return listModels(pane, q.refresh === '1')
})
