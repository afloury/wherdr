import { describe, expect, it } from 'vitest'
import { quotaLevel, quotaShown, readQuotaDisplay } from '../app/utils/quotas'

const now = 1_000_000
describe('quota display: remaining or used', () => {
  it('Remaining by default, Used on request', () => {
    expect(readQuotaDisplay(null)).toBe('left')
    expect(readQuotaDisplay('bizarre')).toBe('left')
    expect(readQuotaDisplay('used')).toBe('used')
  })
  it('converts the remaining share into the used share', () => {
    const w = { used: 32.4, resetsAt: now + 3600000 }
    expect(quotaShown(w, now, 'left')).toBe(68)
    expect(quotaShown(w, now, 'used')).toBe(32)
    // Exhausted session: 0 % remaining, 100 % used.
    expect(quotaShown({ used: 100, resetsAt: now + 60000 }, now, 'used')).toBe(100)
    // Window reset since the reading: nothing used.
    expect(quotaShown({ used: 90, resetsAt: now - 1 }, now, 'used')).toBe(0)
  })
  it('keeps the alert tied to what remains, whatever the display', () => {
    expect(quotaLevel({ used: 95, resetsAt: now + 60000 }, now)).toBe('hi')
    expect(quotaLevel({ used: 5, resetsAt: now + 60000 }, now)).toBe('lo')
  })
})
