import { coreAdminDeps } from '../utils/coreAdminDeps'
import { coreIsGit } from '../utils/coreCreate'

export default defineApi(async (event) => {
  const q = getQuery(event)
  if (process.env.WHERDR_BACKEND === 'core') return coreIsGit(coreAdminDeps(), String(q.path || '') || null, q.machine)
  const m = machineFor(q.machine)
  const dir = underHome(String(q.path || '') || m.home, m.home)
  if (!dir) return { git: false }
  return { git: await isGitRepo(dir, m) }
})
