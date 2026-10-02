// Stop button of the input field: interrupt the agent and check that it stops
// (see interruptSeq.ts). Replies { stopped: false } if the agent is still working.
// From the conversation view (`restore`), a prompt Claude puts back into its
// field leaves the conversation and comes back as { restored: text } for
// wherdr's field (see interruptRestore.ts).
import { interruptAgent } from '../utils/interruptSeq'
import { takeBackInterrupted } from '../utils/interruptRestore'

export default defineApi(async (event, b) => {
  if (!PANE_RE.test(b.pane_id || '')) throw new HerdrError('bad_pane', 'Invalid pane')
  const p = findPane(b.pane_id)
  if (!p || !p.agent) throw new HerdrError('bad_pane', 'No agent in this pane')
  const r = await interruptAgent({ call: (m, params, t) => herdr(m, params, t), sleep, now: Date.now }, p)
  let restored: string | undefined
  if (r.stopped && b.restore === true && p.agent === 'claude') {
    const item = await takeBackInterrupted({
      screen: async () => String(((await herdr('pane.read', { pane_id: p.id, source: 'visible', format: 'ansi' }, 4000)).read || {}).text || ''),
      keys: async (keys) => { await herdr('pane.send_input', { pane_id: p.id, keys }) },
      chat: async () => (await transcripts.chat(p, {})).items || [],
      sleep,
    }).catch(() => null)
    if (item) {
      restored = takeBack(p.id, item)
      log(`interrupted prompt taken back on ${p.id}`)
    }
  }
  setTimeout(poll, 100)
  return { ok: true, ...r, ...(restored !== undefined ? { restored } : {}) }
})
