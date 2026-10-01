export default defineApi(async event => {
  const pane = String(getQuery(event).pane || '')
  if (!PANE_RE.test(pane)) throw new HerdrError('bad_pane', 'Invalid pane')
  const result = await listEfforts(pane)
  const p = findPane(pane)
  if (p && result.current) refreshModel(p)
  return result
})
