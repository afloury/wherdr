// Herdr endpoint protocol ("shell" clients: herdr --remote, desktop…),
// reduced to what is needed to receive notifications. Pure functions,
// tested in tests/herdrEndpoint.test.ts.
//
// Why: `herdr notification show` (plugins, scripts, agents) emits no
// event on the API socket, writes neither its title nor its body to the
// log, and Herdr keeps no history. The server only sends it
// to connected shell clients (ServerMessage::SemanticNotification). wherdr
// therefore connects as a PASSIVE shell client: `surface_active: false`
// (it does not become the foreground client, takes no tab's
// geometry, resizes no pane) and sends nothing after the handshake.
//
// Contract (Herdr 0.9.1, src/protocol/wire.rs and endpoint.rs): "generation 1"
// of the stable endpoint, whose variant order is frozen:
//  - frame: [u32 LE length][bincode 2 payload, standard config];
//    standard bincode: varint integers (< 251: 1 byte; 251: u16; 252:
//    u32; 253: u64), strings = varint length + UTF-8, Option = 0 | 1 + value,
//    enum variant = varint of its index;
//  - client -> server: ClientMessage::EndpointControl (index 20)
//    { kind: "endpoint.hello.v1", data: JSON of the EndpointClientHello };
//  - server -> client: EndpointControl (index 20, "endpoint.welcome.v1",
//    snapshot…), SemanticNotification (index 14); the rest is ignored.

export const CLIENT_ENDPOINT_CONTROL = 20
export const SERVER_SEMANTIC_NOTIFICATION = 14
export const SERVER_ENDPOINT_CONTROL = 20
export const SERVER_SHUTDOWN = 3
export const MAX_FRAME = 32 * 1024 * 1024

export const NOTIFICATION_KINDS = ['needs_attention', 'finished', 'update_installed', 'custom'] as const
export type NotificationKind = typeof NOTIFICATION_KINDS[number] | 'unknown'

export interface HerdrNotification {
  kind: NotificationKind
  title: string
  body: string | null
  sound: 'done' | 'request' | null
  agent: string | null
  workspaceId: string | null
  tabId: string | null
  paneId: string | null
}

export type ServerFrame =
  | { type: 'notification', notification: HerdrNotification }
  | { type: 'control', kind: string, data: string }
  | { type: 'shutdown' }
  | { type: 'other', tag: number }

function varint(n: number): Buffer {
  if (n < 251) return Buffer.from([n])
  if (n < 0x10000) { const b = Buffer.alloc(3); b[0] = 251; b.writeUInt16LE(n, 1); return b }
  const b = Buffer.alloc(5); b[0] = 252; b.writeUInt32LE(n, 1); return b
}
function str(s: string): Buffer {
  const b = Buffer.from(s, 'utf8')
  return Buffer.concat([varint(b.length), b])
}
export function frame(payload: Buffer): Buffer {
  const len = Buffer.alloc(4)
  len.writeUInt32LE(payload.length)
  return Buffer.concat([len, payload])
}

// Handshake: passive shell client, without an active surface.
export function helloFrame(): Buffer {
  const hello = {
    generation: 1,
    cell_width_px: 8,
    cell_height_px: 16,
    surface_size: { cols: 80, rows: 24 },
    pixel_mouse: false,
    direct_graphics: false,
    endpoint_keybindings: false,
    mouse_capture: false,
    surface_active: false,
    surface_reuse: false,
    surface_delta: false,
    snapshot_codecs: ['shell.snapshot.v1'],
    surface_codecs: ['shell.surface.v1'],
    input_codecs: ['shell.input.semantic.v1'],
    blob_codecs: ['shell.blob.v1'],
  }
  return frame(Buffer.concat([varint(CLIENT_ENDPOINT_CONTROL), str('endpoint.hello.v1'), str(JSON.stringify(hello))]))
}

class Reader {
  o = 0
  constructor(private b: Buffer) {}
  private need(n: number) { if (this.o + n > this.b.length) throw new RangeError('truncated frame') }
  u8() { this.need(1); return this.b[this.o++]! }
  varint(): number {
    const f = this.u8()
    if (f < 251) return f
    if (f === 251) { this.need(2); const v = this.b.readUInt16LE(this.o); this.o += 2; return v }
    if (f === 252) { this.need(4); const v = this.b.readUInt32LE(this.o); this.o += 4; return v }
    if (f === 253) { this.need(8); const v = Number(this.b.readBigUInt64LE(this.o)); this.o += 8; return v }
    throw new RangeError('invalid varint')
  }
  string() {
    const n = this.varint()
    this.need(n)
    const s = this.b.toString('utf8', this.o, this.o + n)
    this.o += n
    return s
  }
  optString() { return this.u8() ? this.string() : null }
  optVarint() { return this.u8() ? this.varint() : null }
}

export function decodeServerFrame(payload: Buffer): ServerFrame {
  const r = new Reader(payload)
  const tag = r.varint()
  if (tag === SERVER_SEMANTIC_NOTIFICATION) {
    const kind = r.varint()
    const title = r.string()
    const body = r.optString()
    const sound = r.optVarint()
    const agent = r.optString()
    const workspaceId = r.optString()
    const tabId = r.optString()
    const paneId = r.optString()
    return {
      type: 'notification',
      notification: {
        kind: NOTIFICATION_KINDS[kind] || 'unknown',
        title, body,
        sound: sound === 0 ? 'done' : sound === 1 ? 'request' : null,
        agent, workspaceId, tabId, paneId,
      },
    }
  }
  if (tag === SERVER_ENDPOINT_CONTROL) return { type: 'control', kind: r.string(), data: r.string() }
  if (tag === SERVER_SHUTDOWN) return { type: 'shutdown' }
  return { type: 'other', tag }
}

// Splits the stream into frames (received chunks may cut anywhere).
export class FrameSplitter {
  private buf: Buffer = Buffer.alloc(0)
  push(chunk: Buffer): Buffer[] {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk
    const out: Buffer[] = []
    while (this.buf.length >= 4) {
      const n = this.buf.readUInt32LE(0)
      if (n > MAX_FRAME) throw new RangeError(`trame trop grande (${n} octets)`)
      if (this.buf.length < 4 + n) break
      out.push(this.buf.subarray(4, 4 + n))
      this.buf = this.buf.subarray(4 + n)
    }
    return out
  }
}
