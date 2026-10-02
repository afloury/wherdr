import type { AppConfig } from '../../shared/types'

export default defineApi(async (): Promise<AppConfig> => ({
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
}))
