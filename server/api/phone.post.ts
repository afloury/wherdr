import { phoneAccess, phoneAction } from '../utils/phone'

// Settings › Phone: publish / unpublish on the tailnet, or the address typed
// in Docker mode (server/utils/phone.ts). Runs tailscale: local or unlocked only.
export default defineApi(async (event, body) => {
  if (!phoneAccess(event)) return sendError(event, 403, { error: 'Open wherdr on this computer (localhost) or unlock it', code: 'phone_local' })
  return phoneAction(body || {})
})
