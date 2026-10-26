import { BOARD_MIN } from './sideWidth'

// Keep a useful mobile Board beside a docked conversation. Grid columns need
// more room; the two thresholds deliberately serve different purposes.
export function boardLayout(available: number, panel: number) {
  return { wide: available >= 900, sideBySide: available - panel >= BOARD_MIN }
}
