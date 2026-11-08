import { notificationPresence } from '../../utils/notificationRules'
import { eventSendOptions } from '../../utils/wsCompression'
// WS /ws/events: the agents' state, pushed on every change. The app says
// which agent is on screen: no notification for that one.
export default defineWebSocketHandler({
  upgrade: request => checkUpgrade(request),
  open(peer) {
    watchPeer(peer)
    // crossws passes `compress: undefined` to ws, which turns compression off:
    // chosen per frame instead (permessage-deflate, see utils/wsCompression.ts).
    eventClients.set(peer.id, { send: d => isOpen(peer) && peer.send(d, eventSendOptions(d)), pane: null, visible: false })
    const first = getStateJson()
    peer.send(first, eventSendOptions(first))
  },
  message(peer, message) {
    const raw = messageText(message)
    if (!raw) return
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let m: any
    try { m = JSON.parse(raw) }
    catch { return }
    if (m && m.type === 'ping') { peer.send(JSON.stringify({ type: 'pong' })); return }
    const c = eventClients.get(peer.id)
    if (c && m && m.type === 'viewing') {
      c.pane = PANE_RE.test(m.pane || '') ? m.pane : null
      c.visible = m.visible === true
      notificationPresence.heartbeat(peer.id, c.pane, c.visible)
    }
  },
  close(peer) {
    unwatchPeer(peer)
    eventClients.delete(peer.id)
  },
})
