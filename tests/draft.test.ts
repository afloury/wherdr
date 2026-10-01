import { describe, expect, it } from 'vitest'
import { uploadedAt } from '../app/composables/useDraft'

describe('brouillons', () => {
  it('reads the upload date from the photo name', () => {
    expect(uploadedAt('2026-09-26T00-36-39-393Z-4fa305.jpg')).toBe(Date.parse('2026-09-26T00:36:39.393Z'))
    expect(uploadedAt('autre.jpg')).toBe(0)
  })
})
