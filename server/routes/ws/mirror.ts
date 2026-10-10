// WS /ws/mirror?pane=…: live mirror of a pane, without attaching to it
// (`herdr terminal session observe`, see server/utils/mirror.ts).
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
  close(peer, details) {
    unwatchPeer(peer)
    const s = sessions.get(peer.id)
    sessions.delete(peer.id)
    // 1000: the mirror was closed (anything else: hidden page, dropped connection).
    s?.onClose(details?.code === 1000)
  },
})
