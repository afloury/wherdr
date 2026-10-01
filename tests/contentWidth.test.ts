import { describe, expect, it } from 'vitest'
import { migrateContentWidth, readContentWidth } from '../app/utils/contentWidth'

describe('readContentWidth', () => {
  it('keeps a known value', () => {
    expect(readContentWidth('normal')).toBe('normal')
    expect(readContentWidth('wide')).toBe('wide')
    expect(readContentWidth('full')).toBe('full')
  })
  it('falls back to Normal otherwise', () => {
    expect(readContentWidth(null)).toBe('normal')
    expect(readContentWidth('')).toBe('normal')
    expect(readContentWidth('huge')).toBe('normal')
  })
})

describe('migration de la largeur du contenu', () => {
  it('takes the existing choice then favours the new key', () => {
    expect(migrateContentWidth(null, 'wide')).toBe('wide')
    expect(migrateContentWidth('full', 'normal')).toBe('full')
    expect(migrateContentWidth(null, null)).toBe('normal')
  })
})
