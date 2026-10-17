import { describe, expect, it } from 'vitest'
import { pdfOutputScale } from '../app/utils/pdfPreview'

describe('PDF bitmap budget', () => {
  it('preserves Retina resolution for a phone page', () => {
    expect(pdfOutputScale(374, 529, 3)).toBe(3)
  })
  it('bounds large and unusually tall pages to four million pixels', () => {
    for (const [width, height] of [[1100, 1556], [1100, 20000]]) {
      const scale = pdfOutputScale(width!, height!, 3)
      expect(width! * height! * scale ** 2).toBeLessThanOrEqual(4_194_305)
    }
  })
})
