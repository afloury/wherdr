import { describe, expect, it } from 'vitest'
import { safeUploadExtension } from '../shared/uploadName'

describe('safeUploadExtension', () => {
  it('keeps a simple, lowercase extension', () => {
    expect(safeUploadExtension('PDF')).toBe('pdf')
    expect(safeUploadExtension('jpg')).toBe('jpg')
  })
  it('replaces dangerous names or extensions', () => {
    for (const value of ['', '../txt', 'a/b', 'a.b', 'verylongextension']) {
      expect(safeUploadExtension(value)).toBe('bin')
    }
  })
})
