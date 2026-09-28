import { describe, expect, it } from 'vitest'
import { safeUploadExtension } from '../shared/uploadName'

describe('safeUploadExtension', () => {
  it('conserve une extension simple et sans majuscules', () => {
    expect(safeUploadExtension('PDF')).toBe('pdf')
    expect(safeUploadExtension('jpg')).toBe('jpg')
  })
  it('remplace les noms ou extensions dangereux', () => {
    for (const value of ['', '../txt', 'a/b', 'a.b', 'verylongextension']) {
      expect(safeUploadExtension(value)).toBe('bin')
    }
  })
})
