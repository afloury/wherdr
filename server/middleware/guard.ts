// Every request goes through gateDecision (server/utils/network.ts): first
// where it comes from (this computer, the tailnet, WHERDR_TRUSTED_NETWORKS),
// then the Host header, cross-site API reads, and, once a passkey is set up,
// the lock for everything touching agents (API, images, photos). The app's files are still served so the lock screen can
// be shown. (WebSockets go through the same decision in their `upgrade`.)
// An authenticated request upgrades a cookie from an earlier version (auth.renew).
import type { H3Event } from 'h3'
import { crossSiteRequest, hostAllowed, hostRefusalIsHtml, hostRefusedPage, networkRefusedPage } from '../utils/hosts'
import { checkRequestClient, ensureFresh, gateDecision, networkReady } from '../utils/network'
import { adoptServed } from '../utils/phone'
const HOST_RECHECK_MS = 3000
const HTTP_FRESH_MS = 2000

function htmlRefusal(event: H3Event, page: string) {
  setResponseStatus(event, 403)
  setResponseHeader(event, 'content-type', 'text/html; charset=utf-8')
  setResponseHeader(event, 'cache-control', 'no-store')
  return page
}

export default defineEventHandler(async (event) => {
  await networkReady()
  // Tailscale read at most 2 s ago (Funnel may have been turned on since).
  await ensureFresh(HTTP_FRESH_MS)
  const path = event.path.split('?')[0]!
  const headers = event.node.req.headers
  const check = checkRequestClient(event.node.req.socket?.remoteAddress, headers)
  // An unknown host: maybe an address `tailscale serve` just published. The
  // request only triggers reading Tailscale again (at most every few
  // seconds); its Host header is never what gets allowed.
  if (check.ok && !hostAllowed(headers.host)) await adoptServed(HOST_RECHECK_MS)
  const req = reqOf(event)
  const verdict = gateDecision({
    check, path,
    unlocked: auth.isUnlocked(req),
    hostOk: hostAllowed(headers.host),
    crossSite: crossSiteRequest(headers),
  })
  const html = hostRefusalIsHtml(path, headers.accept)
  switch (verdict) {
    case 'network': {
      const why = !check.ok && (check.reason === 'funnel' || check.reason === 'docker') ? check.reason : undefined
      if (html) return htmlRefusal(event, networkRefusedPage(why))
      const error = why === 'funnel'
        ? 'Tailscale Funnel exposes wherdr to the Internet: turn it off for wherdr\'s port'
        : why === 'docker'
          ? 'Docker publishes wherdr on every network interface: publish it on 127.0.0.1 only'
          : 'wherdr only answers this computer and your tailnet'
      return sendError(event, 403, { error, code: 'network', ...(why ? { why } : {}) })
    }
    case 'host':
      if (html) return htmlRefusal(event, hostRefusedPage(undefined, headers.host))
      return sendError(event, 403, { error: 'Host not allowed', code: 'host' })
    case 'origin':
      return sendError(event, 403, { error: 'Origin refused', code: 'origin' })
    case 'locked':
      return sendError(event, 401, { error: 'App is locked', code: 'locked' })
  }
  const renewed = auth.renew(req)
  if (renewed) appendResponseHeader(event, 'set-cookie', renewed.cookie)
})
