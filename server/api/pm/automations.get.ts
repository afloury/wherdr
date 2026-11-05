// ?project=KEY: the project's automations, their last firings first known.
import { HerdrError } from '../../utils/herdr'
import { pmStore } from '../../utils/pmStore'

export default defineApi(async (event) => {
  const key = String(getQuery(event).project ?? '')
  if (!(await pmStore().projects()).some(p => p.key === key)) throw new HerdrError('not_found', 'Unknown project')
  return { automations: (await pmStore().automations(key)).automations }
})
