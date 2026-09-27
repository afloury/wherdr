import type { AppConfig } from '../../shared/types'

export default defineApi(async (): Promise<AppConfig> => ({
  hostLabel: localMachineLabel(),
  kinds: await installedAgentKinds(localMachine),
  home: HOME,
  dirs: await recentDirs(),
  // Plusieurs machines : chacune avec son dossier personnel et ses récents.
  machines: await machineConfigs(),
  push: { enabled: pushReady(), key: vapidPublicKey(), devices: (await readSubs()).length },
  // Thème de Herdr (lecture seule), pour « Suivre Herdr ».
  herdrTheme: await readHerdrTheme(),
}))
