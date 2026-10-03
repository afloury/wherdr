import { describe, expect, it } from 'vitest'
import { tabRouteStatus } from '../app/utils/tabRoute'

describe('tabRouteStatus', () => {
  it('keeps a cold tab link loading until the first ready state contains it', () => {
    expect(tabRouteStatus(false, false, false, false, false)).toBe('loading')
    expect(tabRouteStatus(false, true, false, true, false)).toBe('loading')
    expect(tabRouteStatus(true, true, true, true, false)).toBe('open')
  })
  it('reports a nonexistent tab after a ready state and the creation grace period', () => {
    expect(tabRouteStatus(false, true, true, false, false)).toBe('loading')
    expect(tabRouteStatus(false, true, true, true, false)).toBe('unavailable')
  })
  it('reports a tab that disappeared after it had been seen', () => {
    expect(tabRouteStatus(false, true, true, false, true)).toBe('unavailable')
  })
})
