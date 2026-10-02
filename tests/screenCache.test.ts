import { describe, expect, it } from 'vitest'
import { SCREEN_MS, keepReading } from '../server/utils/screenCache'

const reading = (o: Partial<Parameters<typeof keepReading>[0] & object> = {}) => ({ rev: 3, strict: false, at: 0, choices: null, screen: null, menu: null, ...o })

describe('keepReading', () => {
  it('re-reads a blocked pane whose first reading found nothing, even at the same revision', () => {
    // Herdr's revision stayed the same while Claude drew its AskUserQuestion box.
    expect(keepReading(reading(), 3, false, false, SCREEN_MS - 1)).toBe(true)
    expect(keepReading(reading(), 3, false, false, SCREEN_MS)).toBe(false)
  })

  it('keeps an empty reading of an idle pane until its revision moves', () => {
    expect(keepReading(reading({ strict: true }), 3, true, false, 60000)).toBe(true)
    expect(keepReading(reading({ strict: true }), 4, true, false, 0)).toBe(false)
  })

  it('re-reads a shown prompt, a watched screen, and after a status change', () => {
    expect(keepReading(reading({ strict: true, choices: {} }), 3, true, false, SCREEN_MS)).toBe(false)
    expect(keepReading(reading({ strict: true }), 3, true, true, SCREEN_MS)).toBe(false)
    expect(keepReading(reading({ strict: true }), 3, false, false, 0)).toBe(false)
    expect(keepReading(undefined, 3, false, false, 0)).toBe(false)
  })
})
