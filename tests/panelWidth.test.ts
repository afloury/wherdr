// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import { clampPanelWidth, panelWidthCss, readPanelWidth, savePanelWidth } from '../app/utils/sideWidth'

describe('ticket panel width', () => {
  beforeEach(() => localStorage.clear())
  it('bounds the panel and reserves 640px for the Board', () => {
    expect(clampPanelWidth(100, 1100)).toBe(320)
    expect(clampPanelWidth(1200, 1700)).toBe(960)
    expect(clampPanelWidth(900, 1100)).toBe(460)
    expect(clampPanelWidth(900, 560)).toBe(320)
    expect(clampPanelWidth(412.7, 1100)).toBe(413)
  })
  it('retains a width across openings and removes it on reset', () => {
    expect(readPanelWidth()).toBeNull()
    savePanelWidth(740)
    expect(readPanelWidth()).toBe(740)
    savePanelWidth(null)
    expect(readPanelWidth()).toBeNull()
    for (const value of ['broken', '100', '9999']) {
      localStorage.setItem('boardPanelWidth', value)
      expect(readPanelWidth()).toBeNull()
    }
  })
  it('keeps CSS responsive to viewport and sidebar changes', () => {
    expect(panelWidthCss(740)).toContain('740px, calc(100vw - var(--side) - 640px)')
    expect(panelWidthCss(null)).toContain('clamp(400px, 44vw, 720px)')
  })
})
