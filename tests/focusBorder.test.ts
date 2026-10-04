import { describe, expect, it } from 'vitest'
import { parseFocusBorder } from '../app/utils/focusBorder'

describe('parseFocusBorder', () => {
  it('keeps a saved choice', () => {
    expect(parseFocusBorder('border')).toBe('border')
    expect(parseFocusBorder('halo')).toBe('halo')
    expect(parseFocusBorder('off')).toBe('off')
  })
  it('falls back to the halo when nothing valid is saved', () => {
    expect(parseFocusBorder(null)).toBe('halo')
    expect(parseFocusBorder('')).toBe('halo')
    expect(parseFocusBorder('c')).toBe('halo')
  })
})
