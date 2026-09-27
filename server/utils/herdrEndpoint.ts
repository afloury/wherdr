// Protocole d'endpoint de Herdr (clients « shell » : herdr --remote, bureau…),
// réduit à ce qu'il faut pour recevoir les notifications. Fonctions pures,
// testées dans tests/herdrEndpoint.test.ts.
//
// Pourquoi : `herdr notification show` (plugins, scripts, agents) n'émet aucun
// événement sur le socket API, n'écrit ni son titre ni son corps dans le
// journal, et Herdr ne garde aucun historique. Le serveur l'envoie seulement
// aux clients shell connectés (ServerMessage::SemanticNotification). wherdr
// s'y connecte donc comme un client shell PASSIF : `surface_active: false`
// (il ne devient pas le client au premier plan, ne prend la géométrie d'aucun
// onglet, ne redimensionne aucun pane) et n'envoie rien après la poignée de main.
//
// Contrat (Herdr 0.9.1, src/protocol/wire.rs et endpoint.rs) : « generation 1 »
// de l'endpoint stable, dont l'ordre des variantes est figé :
//  - trame : [u32 LE longueur][charge bincode 2, config standard] ;
//    bincode standard : entiers en varint (< 251 : 1 octet ; 251 : u16 ; 252 :
//    u32 ; 253 : u64), chaînes = varint longueur + UTF-8, Option = 0 | 1 + valeur,
//    variante d'énumération = varint de son rang ;
//  - client -> serveur : ClientMessage::EndpointControl (rang 20)
//    { kind: "endpoint.hello.v1", data: JSON du EndpointClientHello } ;
//  - serveur -> client : EndpointControl (rang 20, « endpoint.welcome.v1 »,
//    instantané…), SemanticNotification (rang 14) ; le reste est ignoré.

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

// Poignée de main : client shell passif, sans surface active.
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
  private need(n: number) { if (this.o + n > this.b.length) throw new RangeError('trame tronquée') }
  u8() { this.need(1); return this.b[this.o++]! }
  varint(): number {
    const f = this.u8()
    if (f < 251) return f
    if (f === 251) { this.need(2); const v = this.b.readUInt16LE(this.o); this.o += 2; return v }
    if (f === 252) { this.need(4); const v = this.b.readUInt32LE(this.o); this.o += 4; return v }
    if (f === 253) { this.need(8); const v = Number(this.b.readBigUInt64LE(this.o)); this.o += 8; return v }
    throw new RangeError('varint invalide')
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

// Découpe le flux en trames (les morceaux reçus peuvent couper n'importe où).
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
