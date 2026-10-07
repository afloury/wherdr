// `wherdr panel` (the Herdr plugin's "wherdr" action) and the tailnet
// helpers shared with the server: which command each key runs, the phone
// address, Tailscale's errors, and when the QR code shows.
import { describe, expect, it } from 'vitest'
import { keyCommand, render } from '../bin/lib/panel.mjs'
import { phoneAddress, serveError, servedPorts, tailnetDomain, tailnetStatus, tailnetUrl, tailscaleBin } from '../bin/lib/tailnet.mjs'

const URL = 'https://box.example.ts.net:7683/'
const state = (over: Record<string, unknown> = {}) => ({
  version: '1.2.0', mode: 'native', plugin: true, runtime: 'node 22.0.0', url: 'http://localhost:7683', port: '7683',
  answer: 'wherdr', pid: 1, service: { installed: false, running: false }, dir: '/tmp/w',
  tailnet: { installed: true, connected: true, phone: { url: URL, served: true, httpsPort: '7683' }, reach: 'ok' },
  ...over,
})

describe('wherdr panel keys', () => {
  const control = ['sh', '/plugin/scripts/herdr-plugin.sh']

  it('runs the plugin script when it controls the panel', () => {
    expect(keyCommand('s', state(), control)).toEqual([...control, 'start'])
    expect(keyCommand('l', state(), control)).toEqual([...control, 'logs'])
    expect(keyCommand('u', state(), control)).toEqual([...control, 'update'])
  })

  it('turns the login service on, or off when it is installed', () => {
    expect(keyCommand('a', state(), control)).toEqual([...control, 'service', 'install'])
    expect(keyCommand('a', state({ service: { installed: true, running: false } }), control)).toEqual([...control, 'service', 'uninstall'])
  })

  it('P opens the phone setup page itself, not a command', () => {
    expect(keyCommand('p', state(), control)).toBeNull()
  })

  it('runs wherdr itself otherwise: logs follow, update is left to the package manager', () => {
    expect(keyCommand('l', state(), null).slice(-2)).toEqual(['logs', '--follow'])
    expect(keyCommand('u', state(), null)).toBeNull()
    expect(keyCommand('z', state(), control)).toBeNull()
  })
})

describe('phone address', () => {
  const serve = (web: Record<string, string>) => JSON.stringify({ Web: Object.fromEntries(Object.entries(web).map(([k, proxy]) => [k, { Handlers: { '/': { Proxy: proxy } } }])) })

  it('is the tailscale serve entry that proxies to the local port, on whatever HTTPS port', () => {
    expect(phoneAddress('box.example.ts.net', '7683', serve({ 'box.example.ts.net:7683': 'http://127.0.0.1:7683' }))).toEqual({ url: URL, served: true, httpsPort: '7683' })
    expect(phoneAddress('box.example.ts.net', '7683', serve({ 'box.example.ts.net:8101': 'http://127.0.0.1:8101', 'box.example.ts.net:8103': 'http://localhost:7683' }))).toEqual({ url: 'https://box.example.ts.net:8103/', served: true, httpsPort: '8103' })
    expect(phoneAddress('box.example.ts.net', '7683', serve({ 'box.example.ts.net:443': 'http://127.0.0.1:7683' }))?.url).toBe('https://box.example.ts.net/')
  })

  it('is not published when no entry proxies to the local port', () => {
    expect(phoneAddress('box.example.ts.net', '7683', serve({ 'box.example.ts.net:7683': 'http://127.0.0.1:76830' }))?.served).toBe(false)
    expect(phoneAddress('box.example.ts.net', '7683', 'not json')?.served).toBe(false)
    expect(phoneAddress(null, '7683', '')).toBeNull()
  })

  it('lists the HTTPS ports already served, so publishing never replaces another service', () => {
    expect(servedPorts(serve({ 'box.example.ts.net:8101': 'http://127.0.0.1:8101', 'box.example.ts.net:443': 'http://127.0.0.1:3000' }))).toEqual(['8101', '443'])
    expect(servedPorts('{}')).toEqual([])
  })

  it('reads whether Tailscale is connected and issues HTTPS certificates', () => {
    expect(tailnetStatus(JSON.stringify({ BackendState: 'Running', Self: { DNSName: 'box.example.ts.net.' }, CertDomains: ['box.example.ts.net'] })))
      .toEqual({ name: 'box.example.ts.net', connected: true, https: true })
    expect(tailnetStatus(JSON.stringify({ BackendState: 'Stopped', Self: { DNSName: 'box.example.ts.net.' }, CertDomains: null })))
      .toEqual({ name: 'box.example.ts.net', connected: false, https: false })
    expect(tailnetStatus('not json')).toEqual({ name: null, connected: false, https: false })
  })

  it('finds the macOS app binary of Tailscale', () => {
    const mac = '/Applications/Tailscale.app/Contents/MacOS/Tailscale'
    expect(tailscaleBin({ PATH: '/usr/bin' }, (p: string) => p === mac)).toBe(mac)
    expect(tailscaleBin({ PATH: '/opt/x/bin' }, (p: string) => p === '/opt/x/bin/tailscale')).toBe('/opt/x/bin/tailscale')
    expect(tailscaleBin({ PATH: '' }, () => false)).toBeNull()
  })
})

describe('tailscale serve errors', () => {
  it('names the known causes, with a link', () => {
    expect(serveError('Access denied: serve config denied\nUse \'sudo tailscale set --operator=$USER\'')?.code).toBe('operator')
    expect(serveError('Serve is not enabled on your tailnet.\nTo enable, visit:\n\n         https://login.tailscale.com/f/serve?node=abc123\n'))
      .toEqual({ code: 'https', link: 'https://login.tailscale.com/f/serve?node=abc123' })
    expect(serveError('Tailscale is stopped.')?.code).toBe('offline')
    expect(serveError('failed to connect to local tailscaled; it doesn\'t appear to be running')?.code).toBe('offline')
    expect(serveError('something new')).toBeNull()
  })
})

describe('Docker: the address typed by hand', () => {
  it('accepts tailnet HTTPS addresses only', () => {
    expect(tailnetUrl(' https://Box.example.ts.net:7683/settings ')).toBe('https://box.example.ts.net:7683/')
    expect(tailnetUrl('http://box.example.ts.net:7683/')).toBeNull()
    expect(tailnetUrl('https://example.com/')).toBeNull()
    expect(tailnetUrl('https://user:pw@box.example.ts.net/')).toBeNull()
  })

  it('finds the tailnet suffix in the search line copied from the host', () => {
    expect(tailnetDomain('nameserver 192.168.1.1\nsearch home.lan example.ts.net\noptions ndots:1\n')).toBe('example.ts.net')
    expect(tailnetDomain('nameserver 1.1.1.1\n')).toBeNull()
  })
})

describe('panel phone section', () => {
  it('shows the QR code only once the published address answers', () => {
    expect(render(state(), 'QRCODE')).toContain('QRCODE')
    const notAnswering = state({ tailnet: { ...state().tailnet, reach: 'unreachable' } })
    expect(render(notAnswering, 'QRCODE')).not.toContain('QRCODE')
    const unpublished = state({ tailnet: { installed: true, connected: true, phone: { url: URL, served: false, httpsPort: '7683' } } })
    expect(render(unpublished, 'QRCODE')).not.toContain('QRCODE')
    expect(render(unpublished, '')).toContain('Not reachable from your phone yet')
    expect(render(state(), 'QRCODE')).toContain('Set up my phone')
  })
})
