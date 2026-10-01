import { describe, expect, it } from 'vitest'
import { sheetViewport } from '../app/utils/sheetViewport'

describe('sheet viewport', () => {
  it('fills the page when nothing hides it', () => {
    expect(sheetViewport(844, 0, 844)).toEqual({ height: 844, bottom: 0 })
  })
  it('sits above the keyboard when the layout viewport keeps its height', () => {
    expect(sheetViewport(844, 0, 508)).toEqual({ height: 508, bottom: 336 })
  })
  it('follows a visual viewport scrolled by iOS', () => {
    expect(sheetViewport(844, 120, 508)).toEqual({ height: 508, bottom: 216 })
  })
  it('never goes below the page bottom', () => {
    expect(sheetViewport(500, 0, 508)).toEqual({ height: 508, bottom: 0 })
  })
  it('falls back to the page height without a visual viewport', () => {
    expect(sheetViewport(700, 0, 0)).toEqual({ height: 700, bottom: 0 })
  })
})
