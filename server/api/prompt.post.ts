export default defineApi(async (event, b) => {
  if (!PANE_RE.test(b.pane_id || '')) throw new HerdrError('bad_pane', 'pane invalide')
  const text = String(b.text || '')
  if (!text.trim()) throw new HerdrError('empty', 'message vide')
  if (await closePanel(b.pane_id).catch(() => false)) log(`panel closed before sending on ${b.pane_id}`)
  try {
    await agentPrompt(b.pane_id, text)
  } catch (e) {
    // Agent launched less than 3 s ago, which Herdr still considers "starting"
    // (see agentPrompt): the message goes out as soon as Herdr accepts it,
    // like the first message given at creation. Not for a command, nor
    // on top of another message already waiting.
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
