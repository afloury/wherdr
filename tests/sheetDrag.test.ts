import { describe, expect, it } from 'vitest'
import { SHEET_CLOSE_DISTANCE, SHEET_DRAG_SLOP, sheetDragCloses, sheetDragOffset } from '../app/utils/sheetDrag'

describe('sheetDragCloses', () => {
  it('keeps the sheet open for a jitter within the slop, even when fast', () => {
    expect(sheetDragCloses(SHEET_DRAG_SLOP, 5, 600)).toBe(false)
  })
  it('closes on a fast flick past the slop', () => {
    expect(sheetDragCloses(SHEET_DRAG_SLOP + 10, 0.8, 600)).toBe(true)
  })
  it('closes a tall sheet past the fixed distance on a slow release', () => {
    expect(sheetDragCloses(SHEET_CLOSE_DISTANCE - 1, 0, 700)).toBe(false)
    expect(sheetDragCloses(SHEET_CLOSE_DISTANCE, 0, 700)).toBe(true)
  })
  it('closes a short sheet past a quarter of its height', () => {
    expect(sheetDragCloses(49, 0, 200)).toBe(false)
    expect(sheetDragCloses(50, 0, 200)).toBe(true)
  })
  it('never closes on an upward release', () => {
    expect(sheetDragCloses(-200, -3, 600)).toBe(false)
  })
})

describe('sheetDragOffset', () => {
  it('follows the finger down and resists going up', () => {
    expect(sheetDragOffset(80)).toBe(80)
    expect(sheetDragOffset(-100)).toBe(-20)
  })
})
