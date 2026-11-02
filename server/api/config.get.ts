import { coreAdminDeps } from '../utils/coreAdminDeps'
import { coreMachineConfigs, homeOf, kindsOf } from '../utils/coreCreate'
import type { AppConfig } from '../../shared/types'
import { openNetworkMode } from '../utils/network'

async function coreConfig(): Promise<AppConfig> {
  const deps = coreAdminDeps()
  const local = deps.machines().find(m => m.local)
  const [kinds, home, machines] = await Promise.all([
    kindsOf(deps).catch(() => []), homeOf(deps).catch(() => ''), coreMachineConfigs(deps).catch(() => undefined),
  ])
  return { hostLabel: 'Local', kinds, home, dirs: local ? await deps.recent(local) : [], machines, push: { enabled: false, key: null, devices: 0 } }
}

export default defineApi(async (): Promise<AppConfig> => process.env.WHERDR_BACKEND === 'core' ? coreConfig() : ({
  hostLabel: localMachineLabel(),
  kinds: await installedAgentKinds(localMachine),
  home: HOME,
  os: localMachine.os,
  dirs: await recentDirs(),
  // Several machines: each with its home folder and recent folders.
  machines: await machineConfigs(),
  push: { enabled: pushReady(), key: vapidPublicKey(), devices: (await readSubs()).length },
  // Herdr theme (read-only), for "Follow Herdr".
  herdrTheme: await readHerdrTheme(),
  openNetwork: openNetworkMode(),
}))
