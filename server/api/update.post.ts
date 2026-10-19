import { startUpdate } from '../utils/selfupdate'

// One-tap update (server/utils/selfupdate.ts): replaces and restarts this
// server. Any session that reaches this route may run it: the guard already
// limits wherdr to this computer and the tailnet, and to unlocked sessions
// when a passkey is set (a session that can run agents can update wherdr).
export default defineApi(async (_event, body) => ({ job: await startUpdate(body.version) }))
