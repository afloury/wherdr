import { isSlashCommand } from '../../shared/queuedMatch'

export default defineApi(async (event, b) => {
  if (!PANE_RE.test(b.pane_id || '')) throw new HerdrError('bad_pane', 'Invalid pane')
  // Text then keys, in two calls: in a single one, Herdr sends the keys first.
  // Not in the middle of another send of wherdr's (see guardedSend.ts).
  const held = await withPaneLock(b.pane_id, async () => {
    if (findPane(b.pane_id)?.stopped) {
      // Old clients and Project panel actions can still reach the raw route.
      // Preserve complete messages; never send raw keys or commands to a shell.
      if (typeof b.text !== 'string' || !b.text.trim() || isSlashCommand(b.text)
        || !Array.isArray(b.keys) || b.keys.length !== 1 || b.keys[0] !== 'enter') {
        throw new HerdrError('stale', 'Restart Codex before sending a command.')
      }
      const q = addQueued(b.pane_id, b.text, { held: true })
      setTimeout(poll, 50)
      return q
    }
    if (typeof b.text === 'string' && b.text) await herdr('pane.send_input', { pane_id: b.pane_id, text: b.text })
    if (Array.isArray(b.keys) && b.keys.length) await herdr('pane.send_input', { pane_id: b.pane_id, keys: b.keys.map(String) })
  })
  if (held) return { ok: true, queued: held }
  // Free-form answer to an agent (e.g. "Type something"): tracked like a message.
  const p = findPane(b.pane_id)
  if (p && p.agent && typeof b.text === 'string' && b.text.trim() && !isSlashCommand(b.text)) {
    const q = addQueued(b.pane_id, b.text)
    setTimeout(poll, 50)
    return { ok: true, queued: q }
  }
  return { ok: true }
})
