// Phone address helpers, and the setup guide's "done" state kept by the
// server for every device of one machine.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { isLoopbackHost, onAddress, tailnetSwitch } from '../app/utils/onboarding'
import { readOnboarding, writeOnboarding } from '../server/utils/onboarding'

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

describe('onboarding state', () => {
  let dir = ''
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }) })
  const file = () => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'wherdr-onboarding-'))
    return path.join(dir, 'data', 'onboarding.json')
  }

  it('is shown on a new install, then never again once finished or skipped', () => {
    const f = file()
    expect(readOnboarding(f, 'box')).toEqual({ done: false })
    expect(writeOnboarding(true, f, 'box')).toEqual({ done: true })
    expect(readOnboarding(f, 'box')).toEqual({ done: true })
  })

  it('is shown again on another machine with a copied data folder', () => {
    const f = file()
    writeOnboarding(true, f, 'box')
    expect(readOnboarding(f, 'other-box')).toEqual({ done: false })
  })

  it('can be shown again, and treats a damaged file as not done', () => {
    const f = file()
    writeOnboarding(true, f, 'box')
    expect(writeOnboarding(false, f, 'box')).toEqual({ done: false })
    expect(readOnboarding(f, 'box')).toEqual({ done: false })
    writeFileSync(f, '{ not json')
    expect(readOnboarding(f, 'box')).toEqual({ done: false })
  })
})
