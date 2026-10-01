// Herdr plugin actions of a machine (`?machine=<key>`, empty = local).
import type { PluginActionList } from '../../../shared/types'

export default defineApi(async (event): Promise<PluginActionList> => {
  const q = getQuery(event)
  return { actions: await listPluginActions(String(q.machine || '')) }
})
