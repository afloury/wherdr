import { coreInputDeps } from './coreInput'
import { getState, poll } from './state'
import { recentDirs, rememberDir } from './actions'
import type { CoreAdminDeps } from './coreCreate'

// Real dependencies of the creation and machine routes in core mode.
export function coreAdminDeps(): CoreAdminDeps {
  const d = coreInputDeps()
  return {
    call: d.call,
    machines: () => getState().machines ?? [],
    panes: () => getState().panes,
    workspaces: () => getState().workspaces,
    settle: poll,
    recent: m => recentDirs({ local: m.local, key: m.key, profileId: null }),
    remember: (dir, m) => rememberDir(dir, { local: m.local, key: m.key, profileId: null }),
  }
}
