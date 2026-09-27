// WebSockets (crossws via Nitro) : mêmes vérifications que les écritures HTTP
// (Origin identique à l'hôte) + verrouillage, avant d'accepter la connexion.
import type { Peer } from 'crossws'
import { auth } from './http'
import { sameOrigin } from './http'
import { hostAllowed } from './hosts'

const WS_MAX = 256 * 1024

// En-têtes d'une demande d'upgrade (Headers web) -> objet simple.
export function headersOf(h: Headers): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {}
  h.forEach((v, k) => { out[k] = v })
  return out
}

// Refus de l'upgrade : réponse HTTP brute, comme l'ancien serveur.
export function checkUpgrade(request: { headers: Headers }): Response | void {
  const headers = headersOf(request.headers)
  if (!hostAllowed(headers.host)) return new Response(null, { status: 403, statusText: 'Host not allowed' })
  if (!sameOrigin(headers)) return new Response(null, { status: 403, statusText: 'Forbidden' })
  if (!auth.isUnlocked({ headers })) return new Response(null, { status: 401, statusText: 'Unauthorized' })
}

// La WebSocket brute de `ws` derrière un pair crossws (adaptateur Node).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RawWs = { readyState: number, ping: () => void, terminate: () => void, on: (e: string, f: (...a: any[]) => void) => void }
export const rawWs = (peer: Peer): RawWs | null => (peer as unknown as { _internal?: { ws?: RawWs } })._internal?.ws || null
export const isOpen = (peer: Peer) => (rawWs(peer)?.readyState ?? 1) === 1

// Ping régulier : garde la WebSocket ouverte à travers tailscale serve et
// nettoie celles d'un iPhone passé en veille.
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
    catch { /* déjà fermée */ }
  }
}, 25000).unref?.()

// Texte d'un message, refusé au-delà de 256 Ko (comme maxPayload avant).
export function messageText(message: { text: () => string, rawData?: unknown }): string | null {
  const t = message.text()
  return t.length > WS_MAX ? null : t
}
