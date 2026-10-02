import { closeTrailingMention } from '../../shared/attachments'

export default defineApi(async (event, b) => {
  if (!PANE_RE.test(b.pane_id || '')) throw new HerdrError('bad_pane', 'Invalid pane')
  // Attached text file last (`@<path>`): see closeTrailingMention.
  const text = closeTrailingMention(String(b.text || ''))
  if (!text.trim()) throw new HerdrError('empty', 'Empty message')
  if (await closePanel(b.pane_id).catch(() => false)) log(`panel closed before sending on ${b.pane_id}`)
  // A menu or panel still hides the input field (interactive /mcp flow…), or an
  // earlier message is held: typed now, the message would be lost. Held, it is
  // delivered on a later poll once the input is back (see state.ts deliverHeld).
  const p = findPane(b.pane_id)
  if (p && !text.trim().startsWith('/')) {
    const earlier = hasHeld(b.pane_id)
    const input = earlier || !INPUT_STATES.has(p.status || '') ? true
      : await herdr('pane.read', { pane_id: b.pane_id, source: 'detection' }, 4000)
        .then(r => inputVisible(r.read && r.read.text), () => true)
    if (shouldHold(p.agent, p.status, input, earlier)) {
      const q = addQueued(b.pane_id, text, { held: true })
      log(`prompt ${b.pane_id}: input field hidden, message held`)
      setTimeout(poll, 50)
      return { ok: true, queued: q }
    }
  }
  try {
    await agentPrompt(b.pane_id, text)
  } catch (e) {
    // Agent launched less than 3 s ago, which Herdr still considers "starting"
    // (see agentPrompt): the message goes out as soon as Herdr accepts it,
    // like the first message given at creation. Not for a command, nor
    // on top of another message already waiting.
    // Herdr sees the open menu as blocked and refuses the prompt: held too,
    // delivered once the menu is answered or closed.
    if (e instanceof HerdrError && e.code === 'agent_blocked' && p && p.agent && HOLD_AGENTS.has(p.agent) && !text.trim().startsWith('/')) {
      const q = addQueued(b.pane_id, text, { held: true })
      log(`prompt ${b.pane_id}: agent blocked, message held`)
      setTimeout(poll, 50)
      return { ok: true, queued: q }
    }
    if (!(e instanceof HerdrError) || e.code !== 'agent_not_ready' || text.trim().startsWith('/') || pendingPrompts.has(b.pane_id)) throw e
    pendingPrompts.set(b.pane_id, { text, at: Date.now() })
    log(`prompt ${b.pane_id}: agent not ready for Herdr yet, queued`)
  }
  // Commands (/compact…) are not messages: no bubble.
  // An interactive menu (/resume, /model…) may open: screen watched.
  if (text.trim().startsWith('/')) {
    watchScreen(b.pane_id)
    setTimeout(poll, 1500)
    return { ok: true }
  }
  const q = addQueued(b.pane_id, text)
  setTimeout(poll, 50)
  return { ok: true, queued: q }
})
