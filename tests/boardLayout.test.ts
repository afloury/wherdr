import { describe, expect, it } from 'vitest'
import { boardLayout } from '../app/utils/boardLayout'

describe('Board container layout', () => {
  it('uses tabs until the actual Board can fit columns', () => {
    expect(boardLayout(899, 0).wide).toBe(false)
    expect(boardLayout(900, 0).wide).toBe(true)
  })
  it('overlays a conversation unless at least 640px remains for the Board', () => {
    expect(boardLayout(1039, 400).sideBySide).toBe(false)
    expect(boardLayout(1040, 400).sideBySide).toBe(true)
    expect(boardLayout(1040, 500).sideBySide).toBe(false)
  })
})
