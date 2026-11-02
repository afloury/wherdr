import type { AppConfig } from '../../shared/types'
import { openNetworkMode } from '../utils/network'

export default defineApi(async (): Promise<AppConfig> => process.env.WHERDR_BACKEND === 'core' ? {
  hostLabel: 'Local', kinds: [], home: '', dirs: [], push: { enabled: false, key: null, devices: 0 },
} : ({
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
