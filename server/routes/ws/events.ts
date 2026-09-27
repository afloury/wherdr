// WS /ws/events : l'état des agents, poussé à chaque changement. L'app dit
// quel agent est à l'écran : pas de notif pour celui-là.
export default defineWebSocketHandler({
  upgrade: request => checkUpgrade(request),
  open(peer) {
    watchPeer(peer)
    eventClients.set(peer.id, { send: d => isOpen(peer) && peer.send(d), pane: null, visible: false })
    peer.send(getStateJson())
  },
  message(peer, message) {
    const raw = messageText(message)
    if (!raw) return
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let m: any
    try { m = JSON.parse(raw) }
    catch { return }
    const c = eventClients.get(peer.id)
    if (c && m && m.type === 'viewing') {
      c.pane = PANE_RE.test(m.pane || '') ? m.pane : null
      c.visible = Boolean(m.visible)
    }
  },
  close(peer) {
    unwatchPeer(peer)
    eventClients.delete(peer.id)
  },
})
