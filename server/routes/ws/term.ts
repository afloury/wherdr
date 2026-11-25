// WS /ws/term?pane=…&cols=…&rows=…[&takeover=1]: terminal stream of the pane
// (see coreTerm.ts). An open stream keeps a task's agent from its release,
// what is typed in it counts as the user's message to it (pmTalk.ts).
import { streamOpen, userWrote } from '../../utils/pmTalk'
import { frameInput, typed, userRepliedTo } from '../../utils/pmReply'
import { pmStore } from '../../utils/pmStore'

const sessions = new Map<string, TermSession>()
const addresses = new Map<string, string>()
// What each viewer typed since its last Enter: a submitted line to a task's agent is the user's reply (pmReply.ts).
const typing = new Map<string, string>()

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
    const sess = openCoreTerm(ws, url, { endpoint: process.env.HC_SOCKET, address: pane => findPane(pane)?.coreAddress, log })
    if (sess) sessions.set(peer.id, sess)
    const address = sess ? findPane(url.searchParams.get('pane') || '')?.coreAddress : undefined
    if (address) { addresses.set(peer.id, address); streamOpen(address, 1) }
  },
  message(peer, message) {
    const raw = messageText(message)
    if (raw) sessions.get(peer.id)?.onMessage(raw)
    if (raw?.includes('"terminal.input"')) userWrote(addresses.get(peer.id))
    const address = addresses.get(peer.id), input = raw && address ? frameInput(raw) : undefined
    if (input) {
      const t = typed(typing.get(peer.id) ?? '', input)
      typing.set(peer.id, t.buf)
      for (const line of t.lines) void userRepliedTo(pmStore(), address, line).catch(() => {})
    }
  },
  close(peer, details) {
    unwatchPeer(peer)
    const s = sessions.get(peer.id)
    sessions.delete(peer.id)
    streamOpen(addresses.get(peer.id), -1)
    addresses.delete(peer.id)
    typing.delete(peer.id)
    // 1000: the client closed its terminal (anything else: the connection dropped).
    s?.onClose(details?.code === 1000)
  },
})
