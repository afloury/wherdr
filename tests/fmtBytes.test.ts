import { describe, expect, it } from 'vitest'
import { fmtBytes } from '../app/utils/bytes'

describe('fmtBytes', () => {
  it('moves to the next unit instead of showing 1000', () => {
    expect([fmtBytes(812), fmtBytes(4200), fmtBytes(999_950), fmtBytes(999_999_999), fmtBytes(1_300_000)])
      .toEqual(['812 B', '4.2 kB', '1.0 MB', '1.0 GB', '1.3 MB'])
  })
})
