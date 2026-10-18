// Open WebSockets are judged again after every reading of the network state
// (server/utils/ws.ts revalidatePeers): Funnel turned on, or Tailscale
// unreadable, closes those no longer allowed, even if no new upgrade comes.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const data = mkdtempSync(path.join(tmpdir(), 'wherdr-ws-'))
process.env.DATA_DIR = data
type WsModule = typeof import('../server/utils/ws')
type NetModule = typeof import('../server/utils/network')
let ws: WsModule
let net: NetModule
beforeAll(async () => {
  net = await import('../server/utils/network')
  ws = await import('../server/utils/ws')
})
afterAll(() => { net.resetNetworkStateForTests(); rmSync(data, { recursive: true, force: true }) })

const up = { installed: true, readable: true, running: true, selfIps: [], peerIps: ['100.101.102.103'], funnel: false }
const peer = (remoteAddress: string, extra: Record<string, string> = {}) => ({
  remoteAddress,
  request: { headers: new Headers({ host: 'localhost:7683', origin: 'http://localhost:7683', ...extra }) },
  close: vi.fn(),
})

describe('open WebSockets after a change of network state', () => {
  it('closes local ones once Funnel is on or Tailscale cannot be read, keeps tailnet ones while their peer is listed', async () => {
    await net.refreshTailscale(async () => up, Date.now(), false)
    const local = peer('127.0.0.1')
    const tailnet = peer('100.101.102.103')
    expect(ws.revalidatePeers([local, tailnet])).toBe(0)

    // The listener runs after the reading itself (no new upgrade needed).
    const watched = [local, tailnet]
    const stop = net.onNetworkReading(() => { ws.revalidatePeers(watched) })
    await net.refreshTailscale(async () => ({ ...up, funnel: true }), Date.now(), false)
    expect(local.close).toHaveBeenCalledWith(1008, 'Network policy changed')
    expect(tailnet.close).not.toHaveBeenCalled()

    // Tailscale unreadable: the tailnet peer is not vouched for any more.
    await net.refreshTailscale(async () => { throw new Error('socket gone') }, Date.now(), false)
    expect(tailnet.close).toHaveBeenCalledWith(1008, 'Network policy changed')
    stop()
  })

  it('closes one from the open network or with a foreign Origin, and treats an unreadable peer as refused', () => {
    expect(ws.revalidatePeers([peer('192.168.1.20')])).toBe(1)
    expect(ws.revalidatePeers([peer('127.0.0.1', { origin: 'https://evil.example' })])).toBe(1)
    const broken = { remoteAddress: '127.0.0.1', request: { headers: new Headers() }, close: vi.fn() }
    expect(ws.revalidatePeers([broken], () => { throw new Error('boom') })).toBe(1)
  })
})
