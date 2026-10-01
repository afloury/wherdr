import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createAuth } from '../server/utils/auth'
import { allowedHosts, crossSiteRequest, hostAllowed } from '../server/utils/hosts'
import { cspForHtml } from '../server/utils/csp'

const req = (cookie = '') => ({ headers: { origin: 'http://localhost:7683', cookie } })
const auth = (log = () => {}) => createAuth({ dataDir: mkdtempSync(path.join(tmpdir(), 'hw-release-')), log })

describe('allowed hosts', () => {
  const names = allowedHosts('https://phone.example.ts.net:7683/', 'server.lan,192.0.2.9', {
    eth0: [{ address: '10.0.0.4', family: 'IPv4', internal: false, netmask: '', cidr: null, mac: '', scopeid: 0 }],
  })
  it('accepts local names, APP_URL, interfaces and the configuration', () => {
    for (const host of ['localhost:7683', '127.0.0.1:7683', '[::1]:7683', 'phone.example.ts.net:7683', 'server.lan', '10.0.0.4', '192.0.2.9']) {
      expect(hostAllowed(host, names)).toBe(true)
    }
  })
  it('refuses a DNS rebinding origin or a malformed Host', () => {
    for (const host of ['evil.example:7683', 'evil.example@localhost', 'localhost/path', '', 'localhost:bad']) {
      expect(hostAllowed(host, names)).toBe(false)
    }
  })
})

describe('first key and challenges', () => {
  it('logs a token at startup and checks it before the challenge', async () => {
    const lines: string[] = []
    const a = auth((...parts) => lines.push(parts.join(' ')))
    const token = a._bootstrapToken()
    expect(lines.join(' ')).toContain(token)
    await expect(a.registerOptions(req(), {})).rejects.toMatchObject({ code: 'bootstrap' })
    await expect(a.registerOptions(req(), { bootstrapToken: 'incorrect' })).rejects.toMatchObject({ code: 'bootstrap' })
    const options = await a.registerOptions(req(), { bootstrapToken: token })
    expect(options.challenge).toBeTruthy()
    expect(options.__cookie).toMatch(/^hw_challenge=/)
  })

  it('binds each challenge to a client cookie and does not let another client overwrite it', async () => {
    const a = auth()
    const first = await a.loginOptions(req())
    const second = await a.loginOptions(req())
    const cookie1 = first.__cookie.split(';')[0]!
    const cookie2 = second.__cookie.split(';')[0]!
    expect(a._takeChallenge(req(cookie1), 'auth')).toBe(first.challenge)
    expect(a._takeChallenge(req(cookie2), 'auth')).toBe(second.challenge)
    expect(() => a._takeChallenge(req(cookie1), 'auth')).toThrow()
    expect(() => a._takeChallenge(req(), 'auth')).toThrow()
  })
})

it('only allows the exact inline scripts of the Nuxt HTML', () => {
  const policy = cspForHtml('<html><script type="importmap">{"imports":{}}</script><script>window.__NUXT__={}</script><script type="application/json">{}</script></html>', 'localhost:7690')
  expect(policy).toContain("script-src 'self' 'sha256-")
  expect(policy.match(/'sha256-/g)).toHaveLength(2)
  expect(policy.match(/script-src ([^;]+)/)?.[1]).not.toContain('unsafe-inline')
  expect(policy).toContain("frame-ancestors 'none'")
  expect(policy).toContain("connect-src 'self' ws://localhost:7690 wss://localhost:7690")
})

describe('crossSiteRequest', () => {
  it('refuses an API request made from another site, even localhost on another port', () => {
    expect(crossSiteRequest({ 'sec-fetch-site': 'cross-site' })).toBe(true)
    expect(crossSiteRequest({ 'sec-fetch-site': 'same-site' })).toBe(true)
  })
  it('accepts the app itself, a typed address and clients without the header', () => {
    expect(crossSiteRequest({ 'sec-fetch-site': 'same-origin' })).toBe(false)
    expect(crossSiteRequest({ 'sec-fetch-site': 'none' })).toBe(false)
    expect(crossSiteRequest({})).toBe(false)
  })
})
