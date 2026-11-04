// Project management after a restart: once herdr-core answers, each unfinished
// run finds its terminal again by its labels (server/utils/pmLaunch.ts).
import { coreAdminDeps } from '../utils/coreAdminDeps'
import { reconcileRuns } from '../utils/pmLaunch'
import { pmStore } from '../utils/pmStore'

export default defineNitroPlugin((nitroApp) => {
  let tries = 0
  const timer = setInterval(() => {
    if (++tries > 30) return clearInterval(timer)
    reconcileRuns({ ...coreAdminDeps(), store: pmStore() }).then(() => clearInterval(timer), () => {})
  }, 10_000)
  nitroApp.hooks.hook('close', () => clearInterval(timer))
})
