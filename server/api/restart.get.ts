import { restartPlanFor } from '../utils/restart'

// Preview of an agent restart (confirmation): resumed conversation and
// original launch options found, without touching anything.
export default defineApi(async (event) => {
  const pane = String(getQuery(event).pane || '')
  if (!PANE_RE.test(pane)) throw new HerdrError('bad_pane', 'pane invalide')
  const p = findPane(pane)
  if (!p || !p.agent) throw new HerdrError('bad_pane', 'agent introuvable')
  const plan = await restartPlanFor(p)
  return { mode: plan.mode, kept: plan.kept, dropped: plan.dropped, unknownArgs: plan.unknownArgs }
})
