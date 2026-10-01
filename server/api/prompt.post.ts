export default defineApi(async (event, b) => {
  if (!PANE_RE.test(b.pane_id || '')) throw new HerdrError('bad_pane', 'Invalid pane')
  const text = String(b.text || '')
  if (!text.trim()) throw new HerdrError('empty', 'Empty message')
  if (await closePanel(b.pane_id).catch(() => false)) log(`panneau refermé avant envoi sur ${b.pane_id}`)
  try {
    await agentPrompt(b.pane_id, text)
  } catch (e) {
    // Agent lancé il y a moins de 3 s, que Herdr tient encore pour « en
    // démarrage » (cf. agentPrompt) : le message part dès que Herdr l'accepte,
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
