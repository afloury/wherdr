// Bouton Stop du champ de saisie : interrompre l'agent et vérifier qu'il s'arrête
// (cf. interruptSeq.ts). Répond { stopped: false } si l'agent travaille encore.
import { interruptAgent } from '../utils/interruptSeq'

export default defineApi(async (event, b) => {
  if (!PANE_RE.test(b.pane_id || '')) throw new HerdrError('bad_pane', 'Invalid pane')
  const p = findPane(b.pane_id)
  if (!p || !p.agent) throw new HerdrError('bad_pane', 'pas d’agent dans ce pane')
  const r = await interruptAgent({ call: (m, params, t) => herdr(m, params, t), sleep, now: Date.now }, p)
  setTimeout(poll, 100)
  return { ok: true, ...r }
})
