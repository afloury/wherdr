import { phoneAction } from '../utils/phone'

// Settings › Phone: publish / unpublish on the tailnet, or the address typed
// in Docker mode (server/utils/phone.ts). Open to every session the guard
// lets in: a session that can run agents can run tailscale too.
export default defineApi(async (_event, body) => phoneAction(body || {}))
