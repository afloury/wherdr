// Lock all devices: an old cookie, an open WebSocket and a push subscription
// stop working at once (server/utils/revoke.ts).
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('web-push', () => ({
  default: { generateVAPIDKeys: () => ({ publicKey: 'pub', privateKey: 'priv' }), setVapidDetails: () => {}, sendNotification: vi.fn() },
}))

const data = mkdtempSync(path.join(tmpdir(), 'wherdr-revoke-'))
process.env.DATA_DIR = data
let http: typeof import('../server/utils/http')
let push: typeof import('../server/utils/push')
let revoke: typeof import('../server/utils/revoke')
let net: typeof import('../server/utils/network')
beforeAll(async () => {
  net = await import('../server/utils/network')
  http = await import('../server/utils/http')
  push = await import('../server/utils/push')
  revoke = await import('../server/utils/revoke')
})
afterAll(() => { net.resetNetworkStateForTests(); rmSync(data, { recursive: true, force: true }) })

const up = { installed: true, readable: true, running: true, selfIps: [], peerIps: [], funnel: false }

describe('Lock all devices', () => {
  it('closes open WebSockets of the old sessions and drops every push subscription', async () => {
    await net.refreshTailscale(async () => up, Date.now(), false)
    const { auth } = http
    auth._db().credentials.push({ id: 'k1', publicKey: 'x', counter: 0, transports: [], name: 'iPhone', createdAt: '2026-01-01T00:00:00.000Z' })
    const cookie = auth._sessionCookie({ headers: {} }).split(';')[0]!
    const peer = () => ({
      remoteAddress: '127.0.0.1',
      request: { headers: new Headers({ host: 'localhost:7683', origin: 'http://localhost:7683', cookie }) },
      close: vi.fn(),
    })
    const open = peer()
    await push.writeSubs([{ endpoint: 'https://push.example/a', keys: { p256dh: 'k', auth: 'a' }, lang: 'en', addedAt: '2026-01-01T00:00:00.000Z', gen: auth.generation() }])
    // Still unlocked: the WebSocket stays.
    expect((await import('../server/utils/ws')).revalidatePeers([open])).toBe(0)

    auth.lockAll({ headers: { cookie } })
    expect(auth.isUnlocked({ headers: { cookie } })).toBe(false)
    expect(await revoke.revokeEverywhere([open])).toBe(1)
    expect(open.close).toHaveBeenCalledWith(1008, expect.any(String))
    expect(await push.readSubs()).toEqual([])
  })
})
