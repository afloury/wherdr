export default defineApi(async (event, b) => {
  if (!PANE_RE.test(b.pane_id || '')) throw new HerdrError('bad_pane', 'pane invalide')
  const text = String(b.text || '')
  if (!text.trim()) throw new HerdrError('empty', 'message vide')
  if (await closePanel(b.pane_id).catch(() => false)) log(`panneau refermé avant envoi sur ${b.pane_id}`)
  // A menu or panel still hides the input field (interactive /mcp flow…), or an
  // earlier message is held: typed now, the message would be lost. Held, it is
  // delivered on a later poll once the input is back (cf. state.ts deliverHeld).
  const p = findPane(b.pane_id)
  if (p && !text.trim().startsWith('/')) {
    const earlier = hasHeld(b.pane_id)
    const input = earlier || !INPUT_STATES.has(p.status || '') ? true
      : await herdr('pane.read', { pane_id: b.pane_id, source: 'detection' }, 4000)
        .then(r => inputVisible(r.read && r.read.text), () => true)
    if (shouldHold(p.agent, p.status, input, earlier)) {
      const q = addQueued(b.pane_id, text, { held: true })
      log(`prompt ${b.pane_id} : champ de saisie caché, message retenu`)
      setTimeout(poll, 50)
      return { ok: true, queued: q }
    }
  }
  try {
    await agentPrompt(b.pane_id, text)
  } catch (e) {
    // Agent lancé il y a moins de 3 s, que Herdr tient encore pour « en
    // démarrage » (cf. agentPrompt) : le message part dès que Herdr l'accepte,
    // comme le premier message donné à la création. Pas pour une commande, ni
    // par-dessus un autre message déjà en attente.
    // Herdr sees the open menu as blocked and refuses the prompt: held too,
    // delivered once the menu is answered or closed.
    if (e instanceof HerdrError && e.code === 'agent_blocked' && p && p.agent && HOLD_AGENTS.has(p.agent) && !text.trim().startsWith('/')) {
      const q = addQueued(b.pane_id, text, { held: true })
      log(`prompt ${b.pane_id} : agent bloqué, message retenu`)
      setTimeout(poll, 50)
      return { ok: true, queued: q }
    }
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
