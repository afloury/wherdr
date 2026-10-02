import { describe, expect, it } from 'vitest'
import { restoreAtt, uploadedAt } from '../app/composables/useDraft'

describe('brouillons', () => {
  it('reads the upload date from the photo name', () => {
    expect(uploadedAt('2026-09-26T00-36-39-393Z-4fa305.jpg')).toBe(Date.parse('2026-09-26T00:36:39.393Z'))
    expect(uploadedAt('autre.jpg')).toBe(0)
    // Attached files share the date prefix (shared/attachments.ts).
    expect(uploadedAt('2026-10-02T10-20-30-456Z-a1b2c3-spec.pdf')).toBe(Date.parse('2026-10-02T10:20:30.456Z'))
  })

  it('restores an attached file chip from storage', () => {
    const path = '/home/dev/.cache/herdr-web/files/2026-10-02T10-20-30-456Z-a1b2c3-notes.md'
    expect(restoreAtt({ path, name: path.split('/').pop(), file: { label: 'notes.md', size: 12, kind: 'text' }, ref: `@${path}` }))
      .toEqual({ url: '', path, name: path.split('/').pop(), file: { label: 'notes.md', size: 12, kind: 'text' }, ref: `@${path}` })
    expect(restoreAtt({ path: '/x/.cache/herdr-web/uploads/a.jpg', name: 'a.jpg' }).url).toBe('/uploads/a.jpg')
  })
})
