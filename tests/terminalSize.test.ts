import { describe, expect, it } from 'vitest'
import { columnsForWidth, proposeTerminalSize, terminalPixelWidth } from '../app/utils/terminalSize'

describe('largeur du terminal en pixels → colonnes', () => {
  it.each([
    [1440, 'normal', 760, 74],
    [1440, 'wide', 1052, 103],
    [1440, 'full', 1052, 103],
    [1920, 'normal', 760, 74],
    [1920, 'wide', 1100, 108],
    [1920, 'full', 1532, 151],
  ] as const)('%i px de fenêtre, %s : %i px et %i colonnes', (windowWidth, preference, pixels, cols) => {
    const panelWidth = windowWidth - 340 // real width of the computer list
    const width = terminalPixelWidth(panelWidth, preference)
    expect(width).toBe(pixels)
    expect(columnsForWidth(width, 10)).toBe(cols)
  })

  it('stays inside a narrow pane and keeps at least one column', () => {
    expect(terminalPixelWidth(390, 'normal', false)).toBe(390)
    expect(terminalPixelWidth(400, 'wide')).toBe(352)
    expect(columnsForWidth(12, 10)).toBe(1)
  })
})

describe('size proposed for "Fit to this screen"', () => {
  // iPhone 13: #term is 382 px wide, cells 7 × 15 px.
  const style = (values: Record<string, string>) => ({ getPropertyValue: (n: string) => values[n] ?? '0px' }) as unknown as CSSStyleDeclaration
  const parent = {} as HTMLElement
  const element = { parentElement: parent } as unknown as HTMLElement
  const styles = (e: Element) => style(e === parent ? { width: '382px', height: '600px' } : {})
  const term = (scrollback: number, cols: number) => ({
    element, cols, options: { scrollback },
    _core: { _renderService: { dimensions: { css: { cell: { width: 7, height: 15 } } } } },
  })

  it('gives the open size after the other-screen view, with core scrollback on', () => {
    const opened = proposeTerminalSize(term(0, 54), styles) // before web.capabilities
    const fitted = proposeTerminalSize(term(5000, 103), styles) // watching at the desktop size
    expect(opened).toEqual({ cols: 54, rows: 40 })
    expect(fitted).toEqual(opened)
  })

  it('waits for the cell size', () => {
    expect(proposeTerminalSize({ element, _core: { _renderService: { dimensions: { css: { cell: { width: 0, height: 0 } } } } } }, styles)).toBeUndefined()
  })
})
