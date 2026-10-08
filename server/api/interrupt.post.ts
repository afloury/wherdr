// Stop button of the input field: interrupt the agent and check that it stops
// (see interruptSeq.ts). Replies { stopped: false } if the agent is still working.
// From the conversation view (`restore`), a prompt (or a "!" command) Claude
// puts back into its field leaves the conversation and comes back as
// { restored: text } for wherdr's field (see interruptRestore.ts).
import { interruptAgent } from '../utils/interruptSeq'

export default defineApi(async (event, b) => {
  if (!PANE_RE.test(b.pane_id || '')) throw new HerdrError('bad_pane', 'Invalid pane')
  const p = findPane(b.pane_id)
  if (!p || !p.agent) throw new HerdrError('bad_pane', 'No agent in this pane')
  const r = await interruptAgent({ call: (m, params, t) => herdr(m, params, t), sleep, now: Date.now }, p)
  let restored: string | undefined
  let lost = 0
  if (r.stopped && b.restore === true && p.agent === 'claude') {
    const item = await takeBackFromClaude(p)
    if (item) {
      const back = takeBack(p.id, item)
      restored = back.text
      lost = back.lost
      log(`interrupted prompt taken back on ${p.id}`)
    }
  }
  setTimeout(poll, 100)
  // `lost`: photos of that prompt whose path is unknown (Claude keeps no copy).
  return { ok: true, ...r, ...(restored !== undefined ? { restored } : {}), ...(lost ? { lost } : {}) }
})
