import { coreAdminDeps } from '../utils/coreAdminDeps'
import { coreListDirs } from '../utils/coreCreate'

export default defineApi((event) => {
  const q = getQuery(event)
  if (process.env.WHERDR_BACKEND === 'core') return coreListDirs(coreAdminDeps(), String(q.path || '') || null, q.machine)
  return listDirs(String(q.path || '') || null, String(q.machine || ''))
})
