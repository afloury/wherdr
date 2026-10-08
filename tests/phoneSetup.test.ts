// Settings › Phone, server side: who may use it, publishing through a fake
// `tailscale` (its calls recorded), Tailscale errors, the port of another
// service left alone, APP_URL following the address once it answers, and the
// QR code only then.
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as Tailnet from '../bin/lib/tailnet.mjs'
import { failureCause } from '../bin/lib/tailnet.mjs'
import { httpsPortOf, phoneAccess, phoneAction, phoneStatus } from '../server/utils/phone'

// Before the server modules load: their data folder and port.
const fake = vi.hoisted(() => {
  const root = `${process.env.TMPDIR || '/tmp'}/wherdr-phone-${process.pid}`
  process.env.DATA_DIR = `${root}/data`
  process.env.PORT = '7699'
  delete process.env.APP_URL
  return { root, bin: `${root}/tailscale`, reach: 'ok' as 'ok' | 'host' | 'other' | 'unreachable' }
})

vi.mock('../bin/lib/tailnet.mjs', async orig => ({
  ...await orig<typeof Tailnet>(),
  tailscaleBin: () => fake.bin,
  probe: async () => fake.reach === 'unreachable' ? { reach: fake.reach, cause: 'refused' } : { reach: fake.reach, status: 200 },
}))

const NAME = 'box.example.ts.net'
const URL = `https://${NAME}:7699/`
const calls = path.join(fake.root, 'calls.log')
const serveFile = path.join(fake.root, 'serve.json')
const failFile = path.join(fake.root, 'fail.txt')

mkdirSync(fake.root, { recursive: true })
// `tailscale status --json` / `serve status --json` from files; `serve …`
// records its arguments, or fails with the text of fail.txt.
writeFileSync(fake.bin, `#!/bin/sh
if [ "$1" = status ]; then echo '{"BackendState":"Running","Self":{"DNSName":"${NAME}."},"CertDomains":["${NAME}"]}'; exit 0; fi
if [ "$1 $2" = "serve status" ]; then cat "${serveFile}"; exit 0; fi
echo "$*" >> "${calls}"
if [ -f "${failFile}" ]; then cat "${failFile}" >&2; exit 1; fi
case "$*" in
  *off) echo '{}' > "${serveFile}" ;;
  *) echo '{"Web":{"${NAME}:7699":{"Handlers":{"/":{"Proxy":"http://127.0.0.1:7699"}}}}}' > "${serveFile}" ;;
esac
`)
chmodSync(fake.bin, 0o755)
afterAll(() => rmSync(fake.root, { recursive: true, force: true }))

const appUrlFile = () => path.join(process.env.DATA_DIR!, 'app-url.json')
const callLog = () => existsSync(calls) ? readFileSync(calls, 'utf8').trim().split('\n') : []

beforeEach(() => {
  writeFileSync(serveFile, '{}')
  rmSync(calls, { force: true })
  rmSync(failFile, { force: true })
  rmSync(appUrlFile(), { force: true })
  delete process.env.APP_URL
  fake.reach = 'ok'
})

describe('phone setup access', () => {
  const event = (headers: Record<string, string>, peer = '127.0.0.1') =>
    ({ node: { req: { headers, socket: { remoteAddress: peer } } } }) as unknown as Parameters<typeof phoneAccess>[0]

  it('is open to this computer only, never through a proxy such as tailscale serve', () => {
    expect(phoneAccess(event({ host: 'localhost:7699' }))).toBe(true)
    expect(phoneAccess(event({ host: '127.0.0.1:7699' }, '::ffff:127.0.0.1'))).toBe(true)
    expect(phoneAccess(event({ host: `${NAME}:7699` }))).toBe(false)
    expect(phoneAccess(event({ 'host': 'localhost:7699', 'x-forwarded-for': '100.64.0.2' }))).toBe(false)
    expect(phoneAccess(event({ 'host': 'localhost:7699', 'tailscale-user-login': 'someone' }))).toBe(false)
    expect(phoneAccess(event({ host: 'localhost:7699' }, '192.168.1.20'))).toBe(false)
  })
})

describe('phone setup', () => {
  it('shows no QR code before wherdr is published', async () => {
    const s = await phoneStatus()
    expect(s).toMatchObject({ mode: 'native', connected: true, served: false, url: null, suggested: URL, qr: null })
    expect(callLog()).toEqual([])
  })

  it('publishes wherdr’s port, then sets APP_URL and draws the QR code once it answers', async () => {
    const r = await phoneAction({ action: 'publish' })
    expect(callLog()).toEqual(['serve --bg --https=7699 http://127.0.0.1:7699'])
    expect(r).toMatchObject({ ok: true, status: { served: true, url: URL, reach: 'ok', appUrl: URL } })
    expect(r.status.qr?.path).toMatch(/^M\d/)
    expect(JSON.parse(readFileSync(appUrlFile(), 'utf8'))).toEqual({ url: URL })
    expect(process.env.APP_URL).toBe(URL)
  })

  it('keeps the QR code and APP_URL back while the address does not answer', async () => {
    fake.reach = 'unreachable'
    const r = await phoneAction({ action: 'publish' })
    expect(r.status).toMatchObject({ served: true, reach: 'unreachable', qr: null, appUrl: '' })
    expect(existsSync(appUrlFile())).toBe(false)
  })

  it('accepts its own address once wherdr refused it only for the host name', async () => {
    writeFileSync(serveFile, `{"Web":{"${NAME}:7699":{"Handlers":{"/":{"Proxy":"http://127.0.0.1:7699"}}}}}`)
    fake.reach = 'host'
    const s = await phoneStatus()
    expect(process.env.APP_URL).toBe(URL)
    expect(s.appUrl).toBe(URL)
  })

  it('explains the known Tailscale errors', async () => {
    writeFileSync(failFile, 'Access denied: serve config denied\nUse \'sudo tailscale set --operator=$USER\'\n')
    expect(await phoneAction({ action: 'publish' })).toMatchObject({ ok: false, error: 'operator' })
    writeFileSync(failFile, 'Serve is not enabled on your tailnet.\nTo enable, visit:\n\n  https://login.tailscale.com/f/serve?node=abc\n')
    expect(await phoneAction({ action: 'publish' })).toMatchObject({ ok: false, error: 'https', link: 'https://login.tailscale.com/f/serve?node=abc' })
    writeFileSync(failFile, 'boom')
    expect(await phoneAction({ action: 'publish' })).toMatchObject({ ok: false, error: 'failed', detail: expect.stringContaining('boom') })
  })

  it('never replaces another service published on the same HTTPS port', async () => {
    writeFileSync(serveFile, `{"Web":{"${NAME}:7699":{"Handlers":{"/":{"Proxy":"http://127.0.0.1:3000"}}}}}`)
    expect(await phoneAction({ action: 'publish' })).toMatchObject({ ok: false, error: 'taken' })
    expect(callLog()).toEqual([])
  })

  it('unpublishes the HTTPS port wherdr is served on', async () => {
    writeFileSync(serveFile, `{"Web":{"${NAME}:8443":{"Handlers":{"/":{"Proxy":"http://localhost:7699"}}}}}`)
    const r = await phoneAction({ action: 'unpublish' })
    expect(callLog()).toEqual(['serve --https=8443 off'])
    expect(r.status.served).toBe(false)
  })

  it('refuses an unknown action or a typed address that is not a tailnet one', async () => {
    expect(await phoneAction({ action: 'rm -rf' })).toMatchObject({ ok: false, error: 'failed' })
    expect(await phoneAction({ action: 'address', url: 'https://example.com/' })).toMatchObject({ ok: false, error: 'address' })
    expect(callLog()).toEqual([])
  })
})

describe('phone address check', () => {
  it('tells why an address does not answer', () => {
    expect(failureCause({ code: 'ENOTFOUND' })).toBe('dns')
    expect(failureCause({ code: 'ECONNREFUSED' })).toBe('refused')
    expect(failureCause(new Error('timeout'))).toBe('timeout')
    expect(failureCause({ code: 'ERR_TLS_CERT_ALTNAME_INVALID' })).toBe('cert')
    expect(failureCause({ code: 'DEPTH_ZERO_SELF_SIGNED_CERT' })).toBe('cert')
    expect(failureCause({ code: 'EPROTO', message: 'SSL routines:ssl3_get_record:wrong version number' })).toBe('tls')
    expect(failureCause({ code: 'ECONNRESET' })).toBe('network')
  })

  it('keeps the HTTPS port an address is already published on', () => {
    expect(httpsPortOf('https://box.example.ts.net:8103/')).toBe('8103')
    expect(httpsPortOf('https://box.example.ts.net/')).toBe('')
    expect(httpsPortOf(null)).toBe('')
  })

  it('records the reason and the time of an unreachable address', async () => {
    fake.reach = 'unreachable'
    const r = await phoneAction({ action: 'publish' })
    expect(r.status.reach).toBe('unreachable')
    expect(r.status.reachCause).toBe('refused')
    expect(r.status.checkedAt).toBeGreaterThan(0)
  })
})
