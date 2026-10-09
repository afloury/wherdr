// Lock: everything touching agents (API, images, photos) requires an
// unlocked session as soon as a passkey is registered. The app's files
// are still served so the lock screen can be shown.
// (WebSockets do the same check in their `upgrade`.)
// Each authenticated request slides the session (auth.renew).
import { crossSiteRequest, HOST_REFUSED_PAGE, hostAllowed, hostRefusalIsHtml } from '../utils/hosts'
// /api/health: version only, for the one-tap updater (bin/lib/updater.mjs).
const needsUnlock = (p: string) => (p.startsWith('/api/') && !p.startsWith('/api/auth/') && p !== '/api/health') || p.startsWith('/uploads/')

export default defineEventHandler((event) => {
  if (!hostAllowed(event.node.req.headers.host)) {
    if (hostRefusalIsHtml(event.path.split('?')[0]!, event.node.req.headers.accept)) {
      setResponseStatus(event, 403)
      setResponseHeader(event, 'content-type', 'text/html; charset=utf-8')
      setResponseHeader(event, 'cache-control', 'no-store')
      return HOST_REFUSED_PAGE
    }
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
