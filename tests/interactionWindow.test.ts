import { describe, expect, it } from 'vitest'
import { createInteractionWindow } from '../app/utils/interactionWindow'

describe('interactive terminal episode', () => {
  it('debounces opening, keeps cursor changes live, and closes on a stable field', () => {
    const w = createInteractionWindow()
    expect(w.update('terminal', 0)).toBe(false)
    expect(w.update('terminal', 499)).toBe(false)
    expect(w.update('terminal', 500)).toBe(true)
    expect(w.update('terminal', 800)).toBe(true)
    expect(w.update('input', 1000)).toBe(true)
    expect(w.update('input', 1900)).toBe(false)
  })
  it('does not reopen a dismissed episode after oscillations or missed reads', () => {
    const w = createInteractionWindow()
    w.update('terminal', 0)
    w.update('terminal', 500)
    w.dismiss()
    expect(w.update('terminal', 1000)).toBe(false)
    w.update('native', 1100)
    w.update('unknown', 1200)
    w.update('input', 1300)
    w.update('terminal', 1500)
    expect(w.update('terminal', 2100)).toBe(false)
    w.update('input', 2200)
    w.update('input', 3100)
    w.update('terminal', 3200)
    expect(w.update('terminal', 3700)).toBe(true)
  })
  it('keeps an open terminal through errors and brief state oscillations', () => {
    const w = createInteractionWindow()
    w.update('terminal', 0)
    w.update('terminal', 500)
    expect(w.update('unknown', 1000)).toBe(true)
    expect(w.update('input', 1100)).toBe(true)
    expect(w.update('terminal', 1600)).toBe(true)
    expect(w.update('managed', 1700)).toBe(true)
  })
})
