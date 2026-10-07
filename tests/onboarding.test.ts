// First-launch setup guide: which steps a device gets, and the "done" state
// kept by the server for every device of one machine.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { isLoopbackHost, mobileOs, onboardingSteps } from '../app/utils/onboarding'
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
