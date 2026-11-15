import { coreAdminDeps } from '../utils/coreAdminDeps'
import { coreIsGit } from '../utils/coreCreate'

export default defineApi(async (event) => {
  const q = getQuery(event)
  return coreIsGit(coreAdminDeps(), String(q.path || '') || null, q.machine)
})
