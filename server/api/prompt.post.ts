import { closeTrailingMention } from '../../shared/attachments'
import { isSlashCommand } from '../../shared/queuedMatch'

export default defineApi(async (event, b) => {
  if (!PANE_RE.test(b.pane_id || '')) throw new HerdrError('bad_pane', 'Invalid pane')
  // Attached text file last (`@<path>`): see closeTrailingMention.
  const text = closeTrailingMention(String(b.text || ''))
  if (!text.trim()) throw new HerdrError('empty', 'Empty message')
  if (await closePanel(b.pane_id).catch(() => false)) log(`panel closed before sending on ${b.pane_id}`)
  // A menu or panel still hides the input field (interactive /mcp flow…), or an
  // earlier message is held: typed now, the message would be lost. Held, it is
  // delivered on a later poll once the input is back (see state.ts deliverHeld).
  // Photos sent alone start with their path: a message, not a "/" command.
  const p = findPane(b.pane_id)
  if (p && !isSlashCommand(text)) {
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
    if (p) await sendPrompt(p, text)
    else await agentPrompt(b.pane_id, text)
  } catch (e) {
    // Claude's input field holds someone else's text (a draft typed in its
    // terminal…), never cleared: the message waits until it is free.
    if (isBusyError(e) && !isSlashCommand(text)) {
      const q = addQueued(b.pane_id, text, { held: true, busy: (e as HerdrError).code === 'input_busy' })
      log(`prompt ${b.pane_id}: input field not free, message held`)
      setTimeout(poll, 50)
      return { ok: true, queued: q }
    }
    // Typed but not confirmed as taken (see guardedSend.ts): kept, shown as
    // not sent with Retry / Cancel, never silently dropped.
    if (e instanceof HerdrError && ['not_shown', 'not_submitted', 'clear_failed', 'input_contended'].includes(e.code) && !isSlashCommand(text)) {
      const q = addQueued(b.pane_id, text, { failed: true })
      log(`prompt ${b.pane_id}: ${e.message}, message kept as not sent`)
      setTimeout(poll, 50)
      return { ok: true, queued: q }
    }
    // Agent launched less than 3 s ago, which Herdr still considers "starting"
    // (see agentPrompt): the message goes out as soon as Herdr accepts it,
    // like the first message given at creation. Not for a command, nor
    // on top of another message already waiting.
    // Herdr sees the open menu as blocked and refuses the prompt: held too,
    // delivered once the menu is answered or closed.
    if (e instanceof HerdrError && e.code === 'agent_blocked' && p && p.agent && HOLD_AGENTS.has(p.agent) && !isSlashCommand(text)) {
      const q = addQueued(b.pane_id, text, { held: true })
      log(`prompt ${b.pane_id}: agent blocked, message held`)
      setTimeout(poll, 50)
      return { ok: true, queued: q }
    }
    if (!(e instanceof HerdrError) || e.code !== 'agent_not_ready' || isSlashCommand(text) || pendingPrompts.has(b.pane_id)) throw e
    pendingPrompts.set(b.pane_id, { text, at: Date.now() })
    log(`prompt ${b.pane_id}: agent not ready for Herdr yet, queued`)
  }
  // Commands (/compact…) are not messages: no bubble.
  // An interactive menu (/resume, /model…) may open: screen watched.
  if (isSlashCommand(text)) {
    watchScreen(b.pane_id)
    setTimeout(poll, 1500)
    return { ok: true }
  }
  const q = addQueued(b.pane_id, text)
  setTimeout(poll, 50)
  return { ok: true, queued: q }
})
