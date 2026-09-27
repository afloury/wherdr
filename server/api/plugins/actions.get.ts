// Actions des plugins Herdr d'une machine (`?machine=<clé>`, vide = locale).
import type { PluginActionList } from '../../../shared/types'

export default defineApi(async (event): Promise<PluginActionList> => {
  const q = getQuery(event)
  return { actions: await listPluginActions(String(q.machine || '')) }
})
