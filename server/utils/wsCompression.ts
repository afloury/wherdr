// permessage-deflate on /ws/events only. The full state is sent on every change
// (15 KB of JSON for a handful of agents): compressed, the first frame is about
// 2.3 KB, and the next ones, which repeat most of it, about 150 B thanks to the
// window each connection keeps (context takeover).
//
// Nitro has no option for the `ws` server it creates: the plugin
// (server/plugins/wsCompression.ts) sets crossws' `serverOptions` before the
// node-server preset builds it. Every other WebSocket route has the extension
// offer removed from its upgrade request, so it is negotiated on /ws/events alone:
// terminal frames stay as they were (latency first, no zlib per terminal).

export const EVENTS_WS_PATH = '/ws/events'

// Memory: about 150 KB more per /ws/events client (server RSS, 50 clients),
// zlib's window and hash table, allocated with the first compressed frame. A
// handful of phones and tabs are connected at a time.
export const EVENTS_DEFLATE = {
  // Smaller frames (pong, small updates) are sent as they are (eventSendOptions).
  threshold: 1024,
  // Full 32 KB window: a whole state frame fits, the next one compresses
  // against it. memLevel 7 takes 64 KB less than the default for the same
  // output on these frames.
  zlibDeflateOptions: { memLevel: 7 },
  // The browser's messages are tiny ({"type":"ping"}): a 1 KB window for them.
  clientMaxWindowBits: 10,
} as const

// ws applies `threshold` only to connections without context takeover: with
// it, every frame sent with `compress: true` is compressed. The threshold is
// therefore chosen per frame, here.
export function eventSendOptions(data: string) {
  return { compress: data.length >= EVENTS_DEFLATE.threshold }
}

export function compressionAllowed(url: string | undefined): boolean {
  const path = (url || '/').split(/[?#]/, 1)[0]!.replace(/\/+$/, '')
  return path === EVENTS_WS_PATH
}

type UpgradeRequest = { _req?: { url?: string, headers?: Record<string, unknown> } }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type WsOptions = { serverOptions?: Record<string, any>, hooks?: { upgrade?: (req: any) => unknown } & Record<string, unknown> }

// Global upgrade hook: runs before the route's own (crossws), whose answer wins.
export function stripDeflateOffer(request: UpgradeRequest) {
  const req = request._req
  if (req?.headers && !compressionAllowed(req.url)) delete req.headers['sec-websocket-extensions']
}

export function applyWsCompression(options: WsOptions) {
  options.serverOptions = { ...options.serverOptions, perMessageDeflate: EVENTS_DEFLATE }
  const previous = options.hooks?.upgrade
  options.hooks = {
    ...options.hooks,
    upgrade: (request: UpgradeRequest) => {
      stripDeflateOffer(request)
      return previous?.(request)
    },
  }
  return options
}
