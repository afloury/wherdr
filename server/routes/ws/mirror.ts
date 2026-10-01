// WS /ws/mirror?pane=…: live mirror of a pane, without attaching to it
// (`herdr terminal session observe`, cf. server/utils/mirror.ts).
const sessions = new Map<string, TermSession>()

export default defineWebSocketHandler({
  upgrade: request => checkUpgrade(request),
  open(peer) {
    watchPeer(peer)
    const url = new URL(peer.request?.url || '/', 'http://x')
    const sess = openMirror({
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
