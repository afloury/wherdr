import { describe, expect, it } from 'vitest'
import { activeTerminalRenderer, parseTerminalRenderer } from '../app/utils/terminalRenderer'

describe('terminal renderer preference', () => {
  it('defaults to WebGL when the preference is absent or invalid', () => {
    expect(parseTerminalRenderer(null)).toBe('webgl')
    expect(parseTerminalRenderer('')).toBe('webgl')
    expect(parseTerminalRenderer('canvas')).toBe('webgl')
  })

  it('restores the saved HTML choice', () => {
    expect(parseTerminalRenderer('html')).toBe('html')
    expect(parseTerminalRenderer('webgl')).toBe('webgl')
  })

  it('distinguishes the selected HTML renderer from a WebGL fallback', () => {
    expect(activeTerminalRenderer('html', true)).toBe('html')
    expect(activeTerminalRenderer('html', false)).toBe('html')
    expect(activeTerminalRenderer('webgl', true)).toBe('webgl')
    expect(activeTerminalRenderer('webgl', false)).toBe('html-fallback')
  })
})
