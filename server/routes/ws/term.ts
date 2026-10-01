// WS /ws/term?pane=…&cols=…&rows=…[&takeover=1]: terminal stream of the pane,
// `herdr terminal session control` relayed as is.
const sessions = new Map<string, TermSession>()

export default defineWebSocketHandler({
  upgrade: request => checkUpgrade(request),
  open(peer) {
    watchPeer(peer)
    const url = new URL(peer.request?.url || '/', 'http://x')
    const sess = openTerm({
      send: d => peer.send(d),
      close: (code, reason) => peer.close(code, reason),
      isOpen: () => isOpen(peer),
    }, url)
    if (sess) sessions.set(peer.id, sess)
  },
  message(peer, message) {
    const raw = messageText(message)
    if (raw) sessions.get(peer.id)?.onMessage(raw)
  },
  close(peer) {
    unwatchPeer(peer)
    const s = sessions.get(peer.id)
    sessions.delete(peer.id)
    s?.onClose()
  },
})
