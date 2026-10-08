// First-launch setup guide: which steps a device gets, and the "done" state
// kept by the server for every device of one machine.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { isLoopbackHost, mobileOs, onAddress, onboardingSteps, setupHash, stepIndex, tailnetSwitch } from '../app/utils/onboarding'
import { readOnboarding, writeOnboarding } from '../server/utils/onboarding'

describe('onboarding steps', () => {
  it('sets up the phone from a computer, or a phone on the local address', () => {
    expect(onboardingSteps({ phone: false, host: 'localhost', standalone: false })).toEqual(['welcome', 'phone', 'security'])
    expect(onboardingSteps({ phone: false, host: 'box.example.ts.net', standalone: false })).toEqual(['welcome', 'phone', 'security'])
    expect(onboardingSteps({ phone: true, host: '127.0.0.1', standalone: false })).toEqual(['welcome', 'phone', 'security'])
  })

  it('offers Add to Home Screen to a phone already on the tailnet address, until installed', () => {
    expect(onboardingSteps({ phone: true, host: 'box.example.ts.net', standalone: false })).toEqual(['welcome', 'homescreen', 'security'])
    expect(onboardingSteps({ phone: true, host: 'box.example.ts.net', standalone: true })).toEqual(['welcome', 'security'])
  })

  it('tells loopback hosts and phone systems apart', () => {
    expect(['localhost', '127.0.0.1', '127.1.2.3', '[::1]', '::1'].every(isLoopbackHost)).toBe(true)
    expect(['box.example.ts.net', '100.64.0.1', 'localhost.example.com'].some(isLoopbackHost)).toBe(false)
    expect(mobileOs('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)')).toBe('ios')
    expect(mobileOs('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', true)).toBe('ios')
    expect(mobileOs('Mozilla/5.0 (Linux; Android 15; Pixel 9)')).toBe('android')
    expect(mobileOs('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)')).toBe(null)
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

  it('links the same step, or a settings section, on that address', () => {
    expect(onAddress(URL, setupHash('security'))).toBe('https://box.example.ts.net:7683/#/setup?step=security')
    expect(onAddress('https://box.example.ts.net', '#/settings?section=security')).toBe('https://box.example.ts.net/#/settings?section=security')
  })

  it('opens the guide at the step of the link, the first one when unknown', () => {
    const steps = onboardingSteps({ phone: false, host: 'box.example.ts.net', standalone: false })
    expect(stepIndex(steps, 'security')).toBe(2)
    expect(stepIndex(steps, ['phone', 'security'])).toBe(1)
    expect(stepIndex(steps, 'homescreen')).toBe(0)
    expect(stepIndex(steps, undefined)).toBe(0)
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
