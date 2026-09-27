// Choisir une option d'une invite bloquante. On relit l'écran juste avant :
// si la question a changé depuis l'affichage sur le téléphone, on refuse
// plutôt que de valider la mauvaise chose.
export default defineApi(async (event, b) => {
  if (!PANE_RE.test(b.pane_id || '')) throw new HerdrError('bad_pane', 'pane invalide')
  const r = await herdr('pane.read', { pane_id: b.pane_id, source: 'detection' }, 4000)
  const text = r.read && r.read.text
  const choices = parseChoices(text) || parseChoices(text, { strict: true })
  const i = Number(b.index)
  if (!choices || !choices.options[i] || choices.options[i]!.label !== b.label) {
    throw new HerdrError('stale', 'La question a changé entre-temps — regarde l’écran à jour.')
  }
  await herdr('pane.send_input', { pane_id: b.pane_id, keys: keysFor(choices, i) })
  choicesCache.delete(b.pane_id)
  setTimeout(poll, 300)
  return { ok: true }
})
