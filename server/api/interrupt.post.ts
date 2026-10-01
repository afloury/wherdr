// Stop button of the input field: interrupt the agent and check that it stops
// (see interruptSeq.ts). Replies { stopped: false } if the agent is still working.
import { interruptAgent } from '../utils/interruptSeq'

export default defineApi(async (event, b) => {
  if (!PANE_RE.test(b.pane_id || '')) throw new HerdrError('bad_pane', 'Invalid pane')
  const p = findPane(b.pane_id)
  if (!p || !p.agent) throw new HerdrError('bad_pane', 'No agent in this pane')
  const r = await interruptAgent({ call: (m, params, t) => herdr(m, params, t), sleep, now: Date.now }, p)
  setTimeout(poll, 100)
  return { ok: true, ...r }
})
