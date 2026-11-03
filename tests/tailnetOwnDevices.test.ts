// Without a passkey, only the owner's own tailnet devices reach wherdr:
// another user's device in a team tailnet, a node shared in from another
// tailnet or a tagged node is refused ('foreign'); a passkey lets them through
// to the lock. Recorded (anonymized) `tailscale status --json`.
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import { tailnetPeers } from '../bin/lib/tailnet.mjs'
import {
  checkClient, gateDecision, netContext, parseTrustedNetworks, refreshTailscale, resetNetworkStateForTests, type NetContext,
} from '../server/utils/network'
import { networkRefusedPage } from '../server/utils/hosts'

const STATUS = readFileSync(new URL('./recordings/tailscale/status-team.json', import.meta.url), 'utf8')
const peers = tailnetPeers(STATUS)
const ctx = (over: Partial<NetContext> = {}): NetContext => ({
  trusted: parseTrustedNetworks(''),
  tailscale: { running: true, selfIps: peers.selfIps, peerIps: peers.peerIps, otherIps: peers.otherIps, funnel: false },
  ...over,
})
const OWN = ['100.101.102.103', 'fd7a:115c:a1e0::5', '100.101.102.104']
const OTHERS = ['100.80.0.4', 'fd7a:115c:a1e0::4', '100.80.0.5', '100.80.0.6', '100.80.0.7']

afterEach(() => resetNetworkStateForTests())

describe('tailnetPeers: own devices apart from the others', () => {
  it('keeps only peers of the same user that are not shared in', () => {
    expect(peers.selfIps).toEqual(['100.90.1.2', 'fd7a:115c:a1e0::2'])
    expect(peers.peerIps).toEqual(OWN)
    expect(peers.otherIps).toEqual(OTHERS)
  })
  it('counts no peer as yours when this machine\'s user is unknown', () => {
    const s = JSON.parse(STATUS)
    delete s.Self.UserID
    const p = tailnetPeers(JSON.stringify(s))
    expect(p.peerIps).toEqual([])
    expect(p.otherIps).toEqual([...OWN, ...OTHERS])
  })
})

describe('tagged nodes', () => {
  it('never counts a tagged peer as yours, even without its Tags', () => {
    const s = JSON.parse(STATUS)
    for (const p of Object.values(s.Peer) as { HostName: string, Tags?: string[] }[]) if (p.HostName === 'ci-runner') delete p.Tags
    expect(tailnetPeers(JSON.stringify(s)).otherIps).toContain('100.80.0.7')
  })
  it('counts no peer as yours when this machine is tagged (its owner is unknown)', () => {
    const s = JSON.parse(STATUS)
    s.Self.UserID = 2147455555
    s.Self.Tags = ['tag:server']
    const p = tailnetPeers(JSON.stringify(s))
    expect(p.peerIps).toEqual([])
    expect(p.otherIps).toEqual([...OWN, ...OTHERS])
    // Tags missing but the tagged-devices user: same.
    delete s.Self.Tags
    expect(tailnetPeers(JSON.stringify(s)).peerIps).toEqual([])
  })
})

describe('checkClient without a passkey', () => {
  it('accepts the owner\'s own devices, directly and through tailscale serve', () => {
    for (const ip of OWN) {
      expect(checkClient(ip, {}, ctx())).toEqual({ ok: true, zone: 'tailnet' })
      expect(checkClient('127.0.0.1', { 'x-forwarded-for': ip }, ctx())).toEqual({ ok: true, zone: 'tailnet' })
    }
  })
  it('refuses another user\'s device, a shared-in node and a tagged node', () => {
    for (const ip of OTHERS) {
      expect(checkClient(ip, {}, ctx())).toEqual({ ok: false, reason: 'foreign' })
      expect(checkClient('127.0.0.1', { 'x-forwarded-for': ip }, ctx())).toEqual({ ok: false, reason: 'foreign' })
    }
  })
  it('refuses through tailscale serve a tailnet client Tailscale does not list as yours', () => {
    // Joined since the last reading, or Tailscale unreadable: not proven yours.
    expect(checkClient('127.0.0.1', { 'x-forwarded-for': '100.70.0.9' }, ctx())).toEqual({ ok: false, reason: 'forwarded' })
    expect(checkClient('127.0.0.1', { 'x-forwarded-for': OWN[0]! }, ctx({ tailscale: null }))).toEqual({ ok: false, reason: 'forwarded' })
    expect(checkClient('127.0.0.1', { 'x-forwarded-for': '100.70.0.9' }, ctx({ passkey: true }))).toEqual({ ok: true, zone: 'tailnet' })
  })
  it('sees an IPv4 peer behind a dual-stack socket', () => {
    expect(checkClient('::ffff:100.80.0.4', {}, ctx())).toEqual({ ok: false, reason: 'foreign' })
    expect(checkClient('::ffff:100.101.102.104', {}, ctx())).toEqual({ ok: true, zone: 'tailnet' })
  })
  it('keeps loopback for the owner', () => {
    expect(checkClient('127.0.0.1', {}, ctx())).toEqual({ ok: true, zone: 'local' })
  })
  it('refuses at the network step, whatever the lock says', () => {
    const check = checkClient('100.80.0.4', {}, ctx())
    expect(gateDecision({ check, unlocked: true, hostOk: true, path: '/api/state', crossSite: false })).toBe('network')
  })
})

describe('checkClient with a passkey', () => {
  it('lets the other peers through to the lock', () => {
    for (const ip of OTHERS) {
      const check = checkClient(ip, {}, ctx({ passkey: true }))
      expect(check).toEqual({ ok: true, zone: 'tailnet' })
      expect(gateDecision({ check, unlocked: false, hostOk: true, path: '/api/state', crossSite: false })).toBe('locked')
      expect(checkClient('127.0.0.1', { 'x-forwarded-for': ip }, ctx({ passkey: true }))).toEqual({ ok: true, zone: 'tailnet' })
    }
  })
})

describe('readings', () => {
  const facts = { installed: true, readable: true, ...peers, funnel: false }
  it('remembers the other peers through a failed or stale reading', async () => {
    const t0 = Date.now()
    await refreshTailscale(async () => facts, t0)
    expect(checkClient('127.0.0.1', { 'x-forwarded-for': '100.80.0.4' }, netContext(t0))).toEqual({ ok: false, reason: 'foreign' })
    await refreshTailscale(async () => ({ ...facts, readable: false, running: false, selfIps: [], peerIps: [], otherIps: [], funnel: null }), t0 + 1000)
    expect(checkClient('127.0.0.1', { 'x-forwarded-for': '100.80.0.4' }, netContext(t0 + 1000))).toEqual({ ok: false, reason: 'foreign' })
    // Stale: nothing fresh is known, the others are still refused through serve.
    expect(checkClient('127.0.0.1', { 'x-forwarded-for': '100.80.0.4' }, netContext(t0 + 120_000))).toEqual({ ok: false, reason: 'foreign' })
  })
})

describe('refusal page', () => {
  it('says the device is not the owner\'s and points to the passkey', () => {
    const page = networkRefusedPage('foreign')
    expect(page).toContain('not one of the owner')
    expect(page).toContain('passkey')
  })
})
