// Update Codex on the agent's machine with its official command (see
// server/utils/codexStatus.ts). Returns right away: progress goes through
// `pane.codexStatus.update.job` in the state. `dismiss` hides a failure.
export default defineApi(async (event, b) => {
  if (!PANE_RE.test(b.pane_id || '')) throw new HerdrError('bad_pane', 'Invalid pane')
  const p = findPane(b.pane_id)
  if (!p || p.agent !== 'codex') throw new HerdrError('bad_pane', 'agent not found')
  if (b.dismiss === true) {
    codexStatus.dismiss(p)
    return { ok: true }
  }
  const r = await codexStatus.startUpdate(p)
  return { ok: true, command: r.command }
})
