// WebSockets (crossws via Nitro): same checks as HTTP writes
// (Origin identical to the host) + lock, before accepting the connection.
import type { Peer } from 'crossws'
import { auth } from './http'
import { sameOrigin } from './http'
import { hostAllowed } from './hosts'
import { checkRequestClient, gateDecision, networkReady } from './network'

const WS_MAX = 256 * 1024

// Headers of an upgrade request (web Headers) -> plain object.
export function headersOf(h: Headers): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {}
  h.forEach((v, k) => { out[k] = v })
  return out
}

// Upgrade refusal: raw HTTP response, like the old server.
// The TCP peer comes from the Node request behind crossws's proxy (`_req`);
// when it cannot be read, the connection is refused. Same decision as HTTP
// (gateDecision), with the WebSocket rules: Origin identical to the host, and
// the passkey lock always applies.
export async function checkUpgrade(request: { headers: Headers, _req?: { socket?: { remoteAddress?: string } } }): Promise<Response | void> {
  await networkReady()
  const headers = headersOf(request.headers)
  const verdict = gateDecision({
    check: checkRequestClient(request._req?.socket?.remoteAddress, headers),
    passkey: auth.isEnabled(),
    unlocked: auth.isUnlocked({ headers }),
    hostOk: hostAllowed(headers.host),
    crossSite: !sameOrigin(headers),
    path: '/ws', ws: true,
  })
  if (verdict === 'network' || verdict === 'unverified') return new Response(null, { status: 403, statusText: 'Network not allowed' })
  if (verdict === 'host') return new Response(null, { status: 403, statusText: 'Host not allowed' })
  if (verdict === 'origin') return new Response(null, { status: 403, statusText: 'Forbidden' })
  if (verdict === 'locked') return new Response(null, { status: 401, statusText: 'Unauthorized' })
}

// The raw `ws` WebSocket behind a crossws peer (Node adapter).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RawWs = { readyState: number, ping: () => void, terminate: () => void, on: (e: string, f: (...a: any[]) => void) => void }
export const rawWs = (peer: Peer): RawWs | null => (peer as unknown as { _internal?: { ws?: RawWs } })._internal?.ws || null
export const isOpen = (peer: Peer) => (rawWs(peer)?.readyState ?? 1) === 1

// Regular ping: keeps the WebSocket open through tailscale serve and
// cleans up those of an iPhone gone to sleep.
const alive = new Map<Peer, boolean>()
export function watchPeer(peer: Peer) {
  const ws = rawWs(peer)
  alive.set(peer, true)
  if (ws) ws.on('pong', () => alive.set(peer, true))
}
export function unwatchPeer(peer: Peer) { alive.delete(peer) }
setInterval(() => {
  for (const [peer, ok] of alive) {
    const ws = rawWs(peer)
    if (!ws) continue
    if (!ok) {
      ws.terminate()
      alive.delete(peer)
      continue
    }
    alive.set(peer, false)
    try { ws.ping() }
    catch { /* already closed */ }
  }
}, 25000).unref?.()

// Message text, refused beyond 256 KB (like maxPayload before).
export function messageText(message: { text: () => string, rawData?: unknown }): string | null {
  const t = message.text()
  return t.length > WS_MAX ? null : t
}
