// WS /ws/term?pane=…&cols=…&rows=…[&takeover=1]: terminal stream of the pane,
// `herdr terminal session control` relayed as is (herdr-core: see coreTerm.ts).
const sessions = new Map<string, TermSession>()

export default defineWebSocketHandler({
  upgrade: request => checkUpgrade(request),
  open(peer) {
    watchPeer(peer)
    const url = new URL(peer.request?.url || '/', 'http://x')
    const ws = {
      send: (d: string) => peer.send(d),
      close: (code?: number, reason?: string) => peer.close(code, reason),
      isOpen: () => isOpen(peer),
    }
    const sess = process.env.WHERDR_BACKEND === 'core'
      ? openCoreTerm(ws, url, { endpoint: process.env.HC_SOCKET, address: pane => findPane(pane)?.coreAddress, log })
      : openTerm(ws, url)
    if (sess) sessions.set(peer.id, sess)
  },
  message(peer, message) {
    const raw = messageText(message)
    if (raw) sessions.get(peer.id)?.onMessage(raw)
  },
  close(peer, details) {
    unwatchPeer(peer)
    const s = sessions.get(peer.id)
    sessions.delete(peer.id)
    // 1000: the client closed its terminal (anything else: the connection dropped).
    s?.onClose(details?.code === 1000)
  },
})
