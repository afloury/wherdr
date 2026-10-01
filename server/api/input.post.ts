export default defineApi(async (event, b) => {
  if (!PANE_RE.test(b.pane_id || '')) throw new HerdrError('bad_pane', 'Invalid pane')
  // Texte puis touches, en deux appels : dans un seul, Herdr envoie les touches d'abord.
  if (typeof b.text === 'string' && b.text) await herdr('pane.send_input', { pane_id: b.pane_id, text: b.text })
  if (Array.isArray(b.keys) && b.keys.length) await herdr('pane.send_input', { pane_id: b.pane_id, keys: b.keys.map(String) })
  // Free-form answer to an agent (e.g. "Type something"): tracked like a message.
  const p = findPane(b.pane_id)
  if (p && p.agent && typeof b.text === 'string' && b.text.trim() && !b.text.trim().startsWith('/')) {
    const q = addQueued(b.pane_id, b.text)
    setTimeout(poll, 50)
    return { ok: true, queued: q }
  }
  return { ok: true }
})
