import { describe, expect, it } from 'vitest'
import { userMessageParts } from '../app/utils/userMessage'

describe('a delivered user message: photos and files leave its text', () => {
  it('a herdr-core photo path left as text (Send now, Claude\'s queue) shows as the photo', () => {
    const parts = userMessageParts('what is wrong here?\n/srv/state/herdr-core/s1/files/t1/2026-01-01T10-00-00-000Z-a1b2c3.png')
    expect(parts).toEqual({ text: 'what is wrong here?', photos: ['2026-01-01T10-00-00-000Z-a1b2c3.png'], files: [] })
  })

  it('a v2 upload path and an attached file: a photo and a chip, no path in the text', () => {
    const parts = userMessageParts('see\n/home/user/.cache/herdr-web/uploads/a.jpg\n@/home/user/.cache/herdr-web/files/notes.md')
    expect(parts.text).toBe('see')
    expect(parts.photos).toEqual(['a.jpg'])
    expect(parts.files).toEqual([expect.objectContaining({ path: '/home/user/.cache/herdr-web/files/notes.md' })])
  })
})
