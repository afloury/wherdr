// ?project=KEY: the project's automations and the proposals waiting for the user.
import { HerdrError } from '../../utils/herdr'
import { pmStore } from '../../utils/pmStore'

export default defineApi(async (event) => {
  const store = pmStore()
  const p = await store.project(String(getQuery(event).project ?? ''))
  if (!p) throw new HerdrError('not_found', 'Unknown project')
  const f = await store.automations(p.key)
  return { automations: f.automations, proposals: (f.proposals ?? []).filter(x => !x.outcome) }
})
