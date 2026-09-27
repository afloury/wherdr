import { describe, expect, it } from 'vitest'
import { migrateContentWidth, readContentWidth } from '../app/utils/contentWidth'

describe('readContentWidth', () => {
  it('garde une valeur connue', () => {
    expect(readContentWidth('normal')).toBe('normal')
    expect(readContentWidth('wide')).toBe('wide')
    expect(readContentWidth('full')).toBe('full')
  })
  it('revient à Normal sinon', () => {
    expect(readContentWidth(null)).toBe('normal')
    expect(readContentWidth('')).toBe('normal')
    expect(readContentWidth('huge')).toBe('normal')
  })
})

describe('migration de la largeur du contenu', () => {
  it('reprend le choix existant puis privilégie la nouvelle clé', () => {
    expect(migrateContentWidth(null, 'wide')).toBe('wide')
    expect(migrateContentWidth('full', 'normal')).toBe('full')
    expect(migrateContentWidth(null, null)).toBe('normal')
  })
})
