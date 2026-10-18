import { describe, expect, it } from 'vitest'
import { addressZone, checkClient, forwardedClients, hasTailnetAddress, isLoopbackIp, isTailnetIp, listenVerdict, parseTrustedNetworks, plainIp, type NetContext } from '../server/utils/network'

const ctx = (over: Partial<NetContext> = {}, trusted = ''): NetContext => ({ trusted: parseTrustedNetworks(trusted), tailnetUp: true, ...over })
const iface = (address: string) => ({ address, netmask: '', family: address.includes(':') ? 'IPv6' : 'IPv4', mac: '', internal: false, cidr: null }) as never
const ifaces = (...addresses: string[]) => ({ eth0: addresses.map(iface) })

describe('addresses', () => {
  it('normalizes IPv4-mapped and bracketed addresses', () => {
    expect(plainIp('::ffff:127.0.0.1')).toBe('127.0.0.1')
    expect(plainIp('[::1]')).toBe('::1')
    expect(plainIp('fe80::1%eth0')).toBe('fe80::1')
  })
  it('knows loopback and the tailnet ranges', () => {
    expect(isLoopbackIp('127.0.0.1')).toBe(true)
    expect(isLoopbackIp('127.8.9.10')).toBe(true)
    expect(isLoopbackIp('::1')).toBe(true)
    expect(isLoopbackIp('::ffff:127.0.0.1')).toBe(true)
    expect(isLoopbackIp('192.168.1.20')).toBe(false)
    expect(isTailnetIp('100.64.0.1')).toBe(true)
    expect(isTailnetIp('100.127.255.254')).toBe(true)
    expect(isTailnetIp('100.128.0.1')).toBe(false)
    expect(isTailnetIp('100.63.255.255')).toBe(false)
    expect(isTailnetIp('fd7a:115c:a1e0::1')).toBe(true)
    expect(isTailnetIp('fd7a:115c:a1e1::1')).toBe(false)
  })
})

describe('trusted networks', () => {
  it('parses CIDRs, single addresses and `any`, and reports the rest', () => {
    const t = parseTrustedNetworks(' 10.147.17.0/24, 192.168.1.5 ,fd00::/8, nope, 10.0.0.0/40 ')
    expect(t.any).toBe(false)
    expect(t.entries).toEqual(['10.147.17.0/24', '192.168.1.5', 'fd00::/8'])
    expect(t.invalid).toEqual(['nope', '10.0.0.0/40'])
    expect(t.list.check('10.147.17.9', 'ipv4')).toBe(true)
    expect(t.list.check('10.147.18.9', 'ipv4')).toBe(false)
    expect(parseTrustedNetworks('any').any).toBe(true)
    expect(parseTrustedNetworks('').entries).toEqual([])
  })
})

describe('client check', () => {
  it('accepts this computer and the tailnet, refuses the open network', () => {
    expect(checkClient('127.0.0.1', {}, ctx())).toEqual({ ok: true, zone: 'local' })
    expect(checkClient('::ffff:127.0.0.1', {}, ctx())).toEqual({ ok: true, zone: 'local' })
    expect(checkClient('::1', {}, ctx())).toEqual({ ok: true, zone: 'local' })
    expect(checkClient('100.101.102.103', {}, ctx())).toEqual({ ok: true, zone: 'tailnet' })
    expect(checkClient('fd7a:115c:a1e0::5', {}, ctx())).toEqual({ ok: true, zone: 'tailnet' })
    expect(checkClient('192.168.1.20', {}, ctx())).toEqual({ ok: false, reason: 'peer' })
    expect(checkClient('10.0.0.7', {}, ctx())).toEqual({ ok: false, reason: 'peer' })
    expect(checkClient('203.0.113.9', {}, ctx())).toEqual({ ok: false, reason: 'peer' })
    expect(checkClient(undefined, {}, ctx())).toEqual({ ok: false, reason: 'peer' })
    expect(checkClient('', {}, ctx())).toEqual({ ok: false, reason: 'peer' })
  })

  it('does not take a CGNAT LAN for the tailnet while Tailscale is down', () => {
    expect(checkClient('100.70.0.4', {}, ctx({ tailnetUp: false }))).toEqual({ ok: false, reason: 'peer' })
  })

  it('cannot be widened by headers a client writes itself', () => {
    const lan = '192.168.1.20'
    for (const h of [
      { 'x-forwarded-for': '127.0.0.1' },
      { 'forwarded': 'for=100.64.0.1' },
      { 'x-real-ip': '::1' },
      { 'host': 'localhost:7683' },
      { 'tailscale-user-login': 'someone' },
    ]) expect(checkClient(lan, h, ctx())).toEqual({ ok: false, reason: 'peer' })
  })

  it('refuses what a local proxy brings from the open network or the Internet', () => {
    expect(checkClient('127.0.0.1', { 'x-forwarded-for': '100.64.0.2' }, ctx())).toEqual({ ok: true, zone: 'tailnet' })
    expect(checkClient('127.0.0.1', { 'x-forwarded-for': '192.168.1.20' }, ctx())).toEqual({ ok: false, reason: 'forwarded' })
    // Every hop counts: a forged first entry cannot hide the real client.
    expect(checkClient('127.0.0.1', { 'x-forwarded-for': '100.64.0.2, 203.0.113.9' }, ctx())).toEqual({ ok: false, reason: 'forwarded' })
    expect(checkClient('127.0.0.1', { 'x-forwarded-for': '203.0.113.9, 100.64.0.2' }, ctx())).toEqual({ ok: false, reason: 'forwarded' })
    expect(checkClient('127.0.0.1', { 'forwarded': 'for="[2001:db8::1]:4711";proto=https' }, ctx())).toEqual({ ok: false, reason: 'forwarded' })
    expect(checkClient('127.0.0.1', { 'forwarded': 'for=unknown' }, ctx())).toEqual({ ok: false, reason: 'forwarded' })
    expect(checkClient('127.0.0.1', { 'cf-connecting-ip': '198.51.100.4' }, ctx())).toEqual({ ok: false, reason: 'forwarded' })
    expect(checkClient('127.0.0.1', { 'tailscale-funnel-request': '?1' }, ctx())).toEqual({ ok: false, reason: 'funnel' })
  })

  it('accepts the container gateway in Docker, and ranges the owner named', () => {
    expect(checkClient('172.17.0.1', {}, ctx({ gateway: '172.17.0.1' }))).toEqual({ ok: true, zone: 'local' })
    expect(checkClient('172.17.0.5', {}, ctx({ gateway: '172.17.0.1' }))).toEqual({ ok: false, reason: 'peer' })
    expect(checkClient('172.17.0.1', { 'x-forwarded-for': '100.64.0.9' }, ctx({ gateway: '172.17.0.1' }))).toEqual({ ok: true, zone: 'tailnet' })
    expect(checkClient('10.147.17.9', {}, ctx({}, '10.147.17.0/24'))).toEqual({ ok: true, zone: 'trusted' })
    expect(checkClient('127.0.0.1', { 'x-forwarded-for': '10.147.17.9' }, ctx({}, '10.147.17.0/24'))).toEqual({ ok: true, zone: 'trusted' })
    expect(checkClient('192.168.1.20', {}, ctx({}, 'any'))).toEqual({ ok: true, zone: 'open' })
  })

  it('collects every forwarded client', () => {
    expect(forwardedClients({ 'x-forwarded-for': 'a, b', 'forwarded': 'for=192.0.2.43:47011, for="[::1]"', 'x-real-ip': 'c' })).toEqual(['a', 'b', '192.0.2.43', '::1', 'c'])
    expect(addressZone('garbage', ctx())).toBe(null)
  })

  it('sees whether this machine is on the tailnet', () => {
    expect(hasTailnetAddress(ifaces('192.168.1.2', '100.90.1.2'))).toBe(true)
    expect(hasTailnetAddress(ifaces('192.168.1.2'))).toBe(false)
  })
})

describe('listening address', () => {
  const t = parseTrustedNetworks
  it('accepts loopback and this machine’s tailnet address', () => {
    expect(listenVerdict('127.0.0.1', t(''), false, ifaces())).toEqual({ ok: true })
    expect(listenVerdict('', t(''), false, ifaces())).toEqual({ ok: true })
    expect(listenVerdict('localhost', t(''), false, ifaces())).toEqual({ ok: true })
    expect(listenVerdict('::1', t(''), false, ifaces())).toEqual({ ok: true })
    expect(listenVerdict('100.90.1.2', t(''), false, ifaces('100.90.1.2'))).toEqual({ ok: true })
  })
  it('refuses every interface or a LAN address unless the option says so', () => {
    for (const host of ['0.0.0.0', '::', '192.168.1.2', '100.90.1.3']) {
      const v = listenVerdict(host, t(''), false, ifaces('192.168.1.2', '100.90.1.2'))
      expect(v.ok).toBe(false)
      expect(!v.ok && v.message).toContain('WHERDR_TRUSTED_NETWORKS')
    }
    expect(listenVerdict('0.0.0.0', t('10.147.17.0/24'), false, ifaces())).toMatchObject({ ok: true, warn: expect.stringContaining('10.147.17.0/24') })
    expect(listenVerdict('192.168.1.2', t('192.168.1.0/24'), false, ifaces())).toMatchObject({ ok: true })
    expect(listenVerdict('192.168.1.2', t('10.0.0.0/8'), false, ifaces()).ok).toBe(false)
    expect(listenVerdict('0.0.0.0', t('any'), false, ifaces())).toMatchObject({ ok: true, warn: expect.stringContaining('ANY network') })
  })
  it('leaves Docker to the per-request check', () => {
    expect(listenVerdict('0.0.0.0', t(''), true, ifaces())).toEqual({ ok: true })
  })
})
