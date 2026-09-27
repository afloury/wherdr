import { describe, expect, it } from 'vitest'
import { columnsForWidth, terminalPixelWidth } from '../app/utils/terminalSize'

describe('largeur du terminal en pixels → colonnes', () => {
  it.each([
    [1440, 'normal', 760, 74],
    [1440, 'wide', 1052, 103],
    [1440, 'full', 1052, 103],
    [1920, 'normal', 760, 74],
    [1920, 'wide', 1100, 108],
    [1920, 'full', 1532, 151],
  ] as const)('%i px de fenêtre, %s : %i px et %i colonnes', (windowWidth, preference, pixels, cols) => {
    const panelWidth = windowWidth - 340 // largeur réelle de la liste ordinateur
    const width = terminalPixelWidth(panelWidth, preference)
    expect(width).toBe(pixels)
    expect(columnsForWidth(width, 10)).toBe(cols)
  })

  it('reste dans un pane étroit et garde au moins une colonne', () => {
    expect(terminalPixelWidth(390, 'normal', false)).toBe(390)
    expect(terminalPixelWidth(400, 'wide')).toBe(352)
    expect(columnsForWidth(12, 10)).toBe(1)
  })
})
