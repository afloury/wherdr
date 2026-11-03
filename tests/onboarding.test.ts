// Phone address helpers: loopback hosts and continuing on the tailnet address.
import { describe, expect, it } from 'vitest'
import { isLoopbackHost, onAddress, tailnetSwitch } from '../app/utils/onboarding'

describe('loopback hosts', () => {
  it('tells loopback hosts apart', () => {
    expect(['localhost', '127.0.0.1', '127.1.2.3', '[::1]', '::1'].every(isLoopbackHost)).toBe(true)
    expect(['box.example.ts.net', '100.64.0.1', 'localhost.example.com'].some(isLoopbackHost)).toBe(false)
  })
})

describe('continuing on the tailnet address', () => {
  const URL = 'https://box.example.ts.net:7683/'

  it('is offered on localhost once the published address answers', () => {
    expect(tailnetSwitch('localhost', { url: URL, reach: 'ok' })).toEqual({ url: URL, name: 'box.example.ts.net' })
    expect(tailnetSwitch('127.0.0.1', { url: URL, reach: 'ok' })?.name).toBe('box.example.ts.net')
  })

  it('is not offered without an address, before it answers, or off localhost', () => {
    expect(tailnetSwitch('localhost', null)).toBe(null)
    expect(tailnetSwitch('localhost', { url: null, reach: null })).toBe(null)
    for (const reach of ['pending', 'host', 'other', 'unreachable']) expect(tailnetSwitch('localhost', { url: URL, reach })).toBe(null)
    expect(tailnetSwitch('box.example.ts.net', { url: URL, reach: 'ok' })).toBe(null)
    expect(tailnetSwitch('localhost', { url: 'not a url', reach: 'ok' })).toBe(null)
  })

  it('links a settings section on that address', () => {
    expect(onAddress('https://box.example.ts.net', '#/settings?section=security')).toBe('https://box.example.ts.net/#/settings?section=security')
  })
})
