import { describe, expect, it } from 'vitest'
import { pickFocusFx } from '../app/utils/focusFx'

describe('pickFocusFx', () => {
  it('takes a valid value from the address first', () => {
    expect(pickFocusFx('b', 'a')).toBe('b')
    expect(pickFocusFx('0', 'c')).toBe('0')
  })
  it('falls back to the stored value, then to the current border', () => {
    expect(pickFocusFx(null, 'c')).toBe('c')
    expect(pickFocusFx('z', 'a')).toBe('a')
    expect(pickFocusFx(null, null)).toBe('0')
    expect(pickFocusFx('x', 'y')).toBe('0')
  })
})
