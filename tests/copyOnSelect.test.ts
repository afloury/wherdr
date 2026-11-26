import { describe, expect, it } from 'vitest'
import { copyOnSelectText, defaultCopyOnSelect, isEditableElement } from '../app/utils/copyOnSelect'

describe('copy on select', () => {
  it('copies a non-empty selection', () => {
    expect(copyOnSelectText({ enabled: true, text: 'npm run build', inEditable: false })).toBe('npm run build')
  })
  it('ignores an empty or blank selection', () => {
    expect(copyOnSelectText({ enabled: true, text: '', inEditable: false })).toBeNull()
    expect(copyOnSelectText({ enabled: true, text: ' \n', inEditable: false })).toBeNull()
  })
  it('ignores a selection in an input, textarea or contenteditable', () => {
    expect(copyOnSelectText({ enabled: true, text: 'draft', inEditable: true })).toBeNull()
  })
  it('does nothing when the setting is off', () => {
    expect(copyOnSelectText({ enabled: false, text: 'x', inEditable: false })).toBeNull()
  })
  it('defaults on with a fine pointer, off on a phone', () => {
    expect(defaultCopyOnSelect(true)).toBe(true)
    expect(defaultCopyOnSelect(false)).toBe(false)
  })
  it('recognises editable elements', () => {
    const el = (closest: boolean) => ({ closest: () => (closest ? {} : null) }) as unknown as Element
    expect(isEditableElement(el(true))).toBe(true)
    expect(isEditableElement(el(false))).toBe(false)
    expect(isEditableElement(null)).toBe(false)
  })
})
