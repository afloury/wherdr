// Annuler un message en attente : retiré de la file de l'agent, son texte
// revient dans le champ de saisie du téléphone.
export default defineApi(async (event, b) => {
  if (!PANE_RE.test(b.pane_id || '')) throw new HerdrError('bad_pane', 'pane invalide')
  const text = String(b.text || '')
  if (!text.trim()) throw new HerdrError('empty', 'message vide')
  return { ok: true, ...(await cancelQueued(b.pane_id, text, typeof b.id === 'string' ? b.id : undefined)) }
})
