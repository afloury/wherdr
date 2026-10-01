import { dismissRestart, restartAgent } from '../utils/restart'

// Restart an agent in its pane, resuming its conversation (see
// server/utils/restart.ts). Returns right away: progress goes through
// `pane.restart` in the state. `dismiss` clears a displayed failure.
export default defineApi(async (event, b) => {
  if (!PANE_RE.test(b.pane_id || '')) throw new HerdrError('bad_pane', 'Invalid pane')
  if (b.dismiss === true) {
    dismissRestart(b.pane_id)
    return { ok: true }
  }
  const plan = await restartAgent(b.pane_id)
  return { ok: true, mode: plan.mode }
})
