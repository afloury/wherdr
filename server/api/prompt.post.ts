export default defineApi(async (event, b) => {
  if (!PANE_RE.test(b.pane_id || '')) throw new HerdrError('bad_pane', 'pane invalide')
  const text = String(b.text || '')
  if (!text.trim()) throw new HerdrError('empty', 'message vide')
  if (await closePanel(b.pane_id).catch(() => false)) log(`panneau refermé avant envoi sur ${b.pane_id}`)
  try {
    await herdr('agent.prompt', { target: b.pane_id, text })
  } catch (e) {
    // Agent neuf dont Herdr n'a pas fini le démarrage (jusqu'au délai d'agent.start,
    // même s'il attend déjà à l'écran) : le message part dès que Herdr l'accepte,
    // comme le premier message donné à la création. Pas pour une commande, ni
    // par-dessus un autre message déjà en attente.
    if (!(e instanceof HerdrError) || e.code !== 'agent_not_ready' || text.trim().startsWith('/') || pendingPrompts.has(b.pane_id)) throw e
    pendingPrompts.set(b.pane_id, { text, at: Date.now() })
    log(`prompt ${b.pane_id} : agent pas encore prêt pour Herdr, mis en attente`)
  }
  // Les commandes (/compact…) ne sont pas des messages : pas de bulle.
  // Un menu interactif (/resume, /model…) peut s'ouvrir : écran surveillé.
  if (text.trim().startsWith('/')) {
    watchScreen(b.pane_id)
    setTimeout(poll, 1500)
    return { ok: true }
  }
  const q = addQueued(b.pane_id, text)
  setTimeout(poll, 50)
  return { ok: true, queued: q }
})
