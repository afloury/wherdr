// Adds a project: { key, name?, machine, path, base?, template? }. The folder
// must be a git repository on a machine herdr-core reaches. Whether its
// repository is public is checked at once (pmVisibility.ts).
import { pmStore } from '../../utils/pmStore'
import { pmFolderCheck } from '../../utils/pmFolder'
import { coreAdminDeps } from '../../utils/coreAdminDeps'
import { ensureVisibility } from '../../utils/pmVisibility'

export default defineApi(async (_event, body) => {
  const store = pmStore()
  return { project: await ensureVisibility({ ...coreAdminDeps(), store }, await store.addProject(body, pmFolderCheck)) }
})
