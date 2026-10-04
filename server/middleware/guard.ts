// Lock: everything touching agents (API, images, photos) requires an
// unlocked session as soon as a passkey is registered. The app's files
// are still served so the lock screen can be shown.
// (WebSockets do the same check in their `upgrade`.)
// Each authenticated request slides the session (auth.renew).
import { crossSiteRequest, hostAllowed } from '../utils/hosts'
const needsUnlock = (p: string) => (p.startsWith('/api/') && !p.startsWith('/api/auth/')) || p.startsWith('/uploads/')

export default defineEventHandler((event) => {
  if (!hostAllowed(event.node.req.headers.host)) {
    return sendError(event, 403, { error: 'Host not allowed', code: 'host' })
  }
  const path = event.path.split('?')[0]!
  if (path.startsWith('/api/') && crossSiteRequest(event.node.req.headers)) {
    return sendError(event, 403, { error: 'Origin refused', code: 'origin' })
  }
  if (!needsUnlock(path)) return
  const req = reqOf(event)
  if (!auth.isUnlocked(req)) {
    return sendError(event, 401, { error: 'App is locked', code: 'locked' })
  }
  const renewed = auth.renew(req)
  if (renewed) appendResponseHeader(event, 'set-cookie', renewed.cookie)
})
