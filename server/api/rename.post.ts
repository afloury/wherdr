export default defineApi(async (event, b) => {
  if (!PANE_RE.test(b.pane_id || '')) throw new HerdrError('bad_pane', 'pane invalide')
  const label = String(b.label || '').replace(/\s+/g, ' ').trim().slice(0, 60)
  await herdr('pane.rename', { pane_id: b.pane_id, label: label || null })
  setTimeout(poll, 50)
  return { ok: true, label: label || null }
})
