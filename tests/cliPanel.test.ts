// `wherdr panel` (the Herdr plugin's "wherdr" action): which command each key
// runs, and when the phone address and its QR code are shown.
import { describe, expect, it } from 'vitest'
import { keyCommand, phoneAddress, render } from '../bin/lib/panel.mjs'

const state = (over: Record<string, unknown> = {}) => ({
  version: '1.2.0', mode: 'native', plugin: true, runtime: 'node 22.0.0', url: 'http://localhost:7683', port: '7683',
  answer: 'wherdr', pid: 1, service: { installed: false, running: false }, dir: '/tmp/w',
  tailnet: { installed: true, phone: { url: 'https://box.example.ts.net:7683/', served: true } },
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

  it('runs wherdr itself otherwise: logs follow, update is left to the package manager', () => {
    expect(keyCommand('l', state(), null).slice(-2)).toEqual(['logs', '--follow'])
    expect(keyCommand('u', state(), null)).toBeNull()
    expect(keyCommand('z', state(), control)).toBeNull()
  })
})

describe('wherdr panel phone address', () => {
  it('is published only when tailscale serve serves the port', () => {
    expect(phoneAddress('box.example.ts.net', '7683', '{"TCP":{"7683":{"HTTPS":true}}}')).toEqual({ url: 'https://box.example.ts.net:7683/', served: true })
    expect(phoneAddress('box.example.ts.net', '7683', '{"TCP":{"443":{"HTTPS":true}}}')?.served).toBe(false)
    expect(phoneAddress('box.example.ts.net', '7683', 'not json')?.served).toBe(false)
    expect(phoneAddress(null, '7683', '')).toBeNull()
  })

  it('shows the QR code only for a published address', () => {
    expect(render(state(), 'QRCODE')).toContain('QRCODE')
    const unpublished = state({ tailnet: { installed: true, phone: { url: 'https://box.example.ts.net:7683/', served: false } } })
    expect(render(unpublished, 'QRCODE')).not.toContain('QRCODE')
  })
})
