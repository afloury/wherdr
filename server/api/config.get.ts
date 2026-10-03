import type { AppConfig } from '../../shared/types'
import { hostOpenReady } from '../utils/reveal'

export default defineApi(async (): Promise<AppConfig> => ({
  hostLabel: localMachineLabel(),
  kinds: await installedAgentKinds(localMachine),
  home: HOME,
  os: localMachine.os,
  // wherdr in a container on a Mac, with the "open on the host" route set up:
  // local panes behave as Mac panes for Reveal in Finder / Open / Mod+Alt+O.
  hostOpen: hostOpenReady(),
  ...(await recentDirsWithKinds()),
  // Several machines: each with its home folder and recent folders.
  machines: await machineConfigs(),
  push: { enabled: pushReady(), key: vapidPublicKey(), devices: (await readSubs()).length },
  // Herdr theme (read-only), for "Follow Herdr".
  herdrTheme: await readHerdrTheme(),
}))
