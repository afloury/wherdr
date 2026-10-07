// wherdr.dev install section: the method recommended for the visitor's system.
import { describe, expect, it } from 'vitest'
import { installOs } from '../website/app/utils/recommend'

describe('recommended install method', () => {
  it('recommends by computer system, and nothing for phones or Windows', () => {
    expect(installOs('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15')).toBe('mac')
    expect(installOs('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/140.0 Safari/537.36')).toBe('linux')
    expect(installOs('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/140.0')).toBe(null)
    expect(installOs('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)')).toBe(null)
    expect(installOs('Mozilla/5.0 (Linux; Android 15; Pixel 9) Chrome/140.0 Mobile')).toBe(null)
    // iPadOS presents itself as a Mac with a touch screen.
    expect(installOs('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 5)).toBe(null)
  })
})
