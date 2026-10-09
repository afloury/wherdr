import { phoneAccess } from '../utils/phone'
import { startUpdate } from '../utils/selfupdate'

// One-tap update (server/utils/selfupdate.ts): replaces and restarts this
// server, so local or unlocked sessions only (same guard as /api/phone).
export default defineApi(async (event, body) => {
  if (!phoneAccess(event)) return sendError(event, 403, { error: 'Open wherdr on this computer (localhost) or unlock it', code: 'update_local' })
  return { job: await startUpdate(body.version) }
})
