import { describe, expect, it } from 'vitest'
import { Terminal } from '@xterm/xterm'
import { takeLines, trackSgrMouse, wheelPixels, wheelReports } from '../app/utils/terminalWheel'
import { writeTerminalFrame } from '../app/utils/terminalFrame'

describe('wheelPixels', () => {
  it('garde les pixels tels quels', () => {
    expect(wheelPixels(-100, 0, 16, 40)).toBe(-100)
  })
  it('converts lines (Firefox) and pages', () => {
    expect(wheelPixels(3, 1, 16, 40)).toBe(48)
    expect(wheelPixels(-1, 2, 16, 40)).toBe(-640)
  })
})

describe('takeLines', () => {
  it('returns whole lines and keeps the remainder', () => {
    expect(takeLines(50, 16)).toEqual({ lines: 3, rest: 2 })
    expect(takeLines(-50, 16)).toEqual({ lines: -3, rest: -2 })
  })
  it('does nothing below one line', () => {
    expect(takeLines(10, 16)).toEqual({ lines: 0, rest: 10 })
  })
  it('guards against a zero line height', () => {
    expect(takeLines(32, 0)).toEqual({ lines: 2, rest: 0 })
  })
})

describe('wheelReports', () => {
  it('sends one SGR report per line, up (64) or down (65), at a 1-based cell', () => {
    expect(wheelReports(2, { column: 4, row: 9 }, true)).toBe('\x1b[<64;5;10M\x1b[<64;5;10M')
    expect(wheelReports(-1, { column: 0, row: 0 }, true)).toBe('\x1b[<65;1;1M')
  })
  it('falls back to X10 bytes, coordinates capped at 223, and bounds the count', () => {
    expect(wheelReports(1, { column: 4, row: 300 }, false)).toBe('\x1b[M`%\xff')
    expect(wheelReports(-500, { column: 0, row: 0 }, true, 3)).toBe('\x1b[<65;1;1M'.repeat(3))
    expect(wheelReports(0, { column: 0, row: 0 }, true)).toBe('')
  })
})

describe('trackSgrMouse', () => {
  const write = (t: Terminal, d: string) => new Promise<void>(r => t.write(d, r))
  it('follows DECSET 1006 and drops it with xterm on a full-frame reset and on RIS', async () => {
    const t = new Terminal({ allowProposedApi: true })
    const sgr = trackSgrMouse(t)
    await write(t, '\x1b[?1000;1006h')
    expect(sgr.on()).toBe(true)
    await new Promise<void>(r => writeTerminalFrame(t, { reset: true, bytes: new TextEncoder().encode('\x1b[?1000h') }, { reset: sgr.reset, written: r }))
    expect(t.modes.mouseTrackingMode).toBe('vt200')
    expect(sgr.on()).toBe(false)
    await write(t, '\x1b[?1006h')
    expect(sgr.on()).toBe(true)
    await write(t, '\x1bc\x1b[?1000h')
    expect(sgr.on()).toBe(false)
    await write(t, '\x1b[?1006l')
    expect(sgr.on()).toBe(false)
    t.dispose()
  })
})
