import { describe, expect, it } from 'vitest'
import { terminalCell } from '../app/utils/terminalMouse'

describe('terminal mouse cells', () => {
  it('uses zero-based cells with screen geometry and clamps a release outside the screen', () => {
    const rect = { left: 20, top: 30, width: 800, height: 400 }
    expect(terminalCell(25, 35, rect, 80, 20)).toEqual({ column: 0, row: 0 })
    expect(terminalCell(415, 235, rect, 80, 20)).toEqual({ column: 39, row: 10 })
    expect(terminalCell(900, -10, rect, 80, 20)).toEqual({ column: 79, row: 0 })
    expect(terminalCell(0, 0, { ...rect, width: 0 }, 80, 20)).toBeNull()
  })
})
