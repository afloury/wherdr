// Appuyer sur une touche de la légende d'un écran d'attente (« t trust all »,
// « esc close »…), à la demande de l'utilisateur seulement. On relit l'écran
// juste avant : si la légende a changé, on refuse plutôt que d'appuyer à l'aveugle.
export default defineApi(async (event, b) => {
  if (!PANE_RE.test(b.pane_id || '')) throw new HerdrError('bad_pane', 'pane invalide')
  const r = await herdr('pane.read', { pane_id: b.pane_id, source: 'detection' }, 4000)
  const text = r.read && r.read.text
  const screen = parseWaitScreen(text, { choices: Boolean(parseChoices(text, { strict: true })) })
  const a = screen && screen.actions.find(x => x.key === b.key && x.label === b.label)
  if (!a) throw new HerdrError('stale', 'L’écran a changé entre-temps — regarde l’écran à jour.')
  // Toujours en touche, lettres comprises : envoyée comme texte (collage), Codex ignore « t ».
  await herdr('pane.send_input', { pane_id: b.pane_id, keys: [a.key] })
  choicesCache.delete(b.pane_id)
  setTimeout(poll, 300)
  return { ok: true }
})
