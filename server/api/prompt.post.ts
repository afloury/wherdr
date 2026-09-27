export default defineApi(async (event, b) => {
  if (!PANE_RE.test(b.pane_id || '')) throw new HerdrError('bad_pane', 'pane invalide')
  const text = String(b.text || '')
  if (!text.trim()) throw new HerdrError('empty', 'message vide')
  if (await closePanel(b.pane_id).catch(() => false)) log(`panneau refermé avant envoi sur ${b.pane_id}`)
  await herdr('agent.prompt', { target: b.pane_id, text })
  // Les commandes (/compact…) ne sont pas des messages : pas de bulle.
  if (text.trim().startsWith('/')) return { ok: true }
  const q = addQueued(b.pane_id, text)
  setTimeout(poll, 50)
  return { ok: true, queued: q }
})
