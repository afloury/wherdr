// "Dismiss" on the card of a Codex stopped by its own update: the user
// handles that shell themselves. Nothing is written to the pane.
export default defineApi(async (event, b) => {
  if (!PANE_RE.test(b.pane_id || '')) throw new HerdrError('bad_pane', 'Invalid pane')
  await withPaneLock(b.pane_id, async () => {
    // A restart started from the card meanwhile owns the pane: nothing to dismiss.
    if (findPane(b.pane_id)?.stopped && !restarting(b.pane_id)) dismissStopped(b.pane_id)
  })
  await poll()
  return { ok: true }
})
