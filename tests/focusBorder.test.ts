import { describe, expect, it } from 'vitest'
import { parseFocusBorder } from '../app/utils/focusBorder'

describe('parseFocusBorder', () => {
  it('keeps a saved choice', () => {
    expect(parseFocusBorder('border')).toBe('border')
    expect(parseFocusBorder('halo')).toBe('halo')
    expect(parseFocusBorder('off')).toBe('off')
  })
  it('falls back to the animated border when nothing valid is saved', () => {
    expect(parseFocusBorder(null)).toBe('border')
    expect(parseFocusBorder('')).toBe('border')
    expect(parseFocusBorder('c')).toBe('border')
  })
})
