import { describe, expect, it } from 'vitest'
import { Terminal as HeadlessTerminal } from '@xterm/headless'
import type { Terminal as XtermTerminal } from '@xterm/xterm'
import { registerEraseInDisplay } from '../app/utils/terminalScrollback'

const write = (term: HeadlessTerminal, data: string) => new Promise<void>(resolve => term.write(data, resolve))
const transcript = (lines: number) => Array.from({ length: lines }, (_, i) => `line ${i + 1}\r\n`).join('')
const bufferLines = (term: HeadlessTerminal) => Array.from({ length: term.buffer.active.length }, (_, i) => term.buffer.active.getLine(i)?.translateToString(true) ?? '')
const visibleLines = (term: HeadlessTerminal) => bufferLines(term).filter(Boolean)

async function sameStream(keepSavedLines: boolean | undefined, stream: string, rows = 30) {
  const term = new HeadlessTerminal({ cols: 20, rows, scrollback: 5000, allowProposedApi: true })
  if (keepSavedLines !== undefined) {
    registerEraseInDisplay(term as unknown as XtermTerminal, () => keepSavedLines, () => {})
  }
  await write(term, stream)
  return term
}

describe('core scrollback across erase in display', () => {
  it('keeps every agy line through ESC[2J ESC[3J ESC[H', async () => {
    const term = await sameStream(true, `${transcript(100)}\x1b[2J\x1b[3J\x1b[Hfooter`)
    const lines = bufferLines(term)
    expect(lines.slice(0, 100)).toEqual(Array.from({ length: 100 }, (_, i) => `line ${i + 1}`))
    expect(lines[100]).toBe('footer')
  })

  it.each([
    ['Codex --no-alt-screen', '\x1b[2J\x1b[3J\x1b[H'],
    ['omp', '\x1b[H\x1b[2J\x1b[3J'],
  ])('%s redraws without duplicated history on a non-agy pane', async (_, clear) => {
    const stream = `${transcript(30)}${clear}${transcript(30)}`
    const term = await sameStream(false, stream, 10)
    const stock = await sameStream(undefined, stream, 10)
    expect(visibleLines(term)).toEqual(visibleLines(stock))
    expect(term.buffer.active.length).toBe(stock.buffer.active.length)
    expect(stock.buffer.active.length).toBe(31)
  })

  it('erases as stock on agy when a scroll region is set', async () => {
    const stream = `${transcript(40)}\x1b[3;8r\x1b[2J\x1b[Hx`
    const term = await sameStream(true, stream, 10)
    const stock = await sameStream(undefined, stream, 10)
    expect(bufferLines(term)).toEqual(bufferLines(stock))
  })

  it('keeps stock behavior for a shell clear on a non-agy pane', async () => {
    const stream = `${transcript(40)}\x1b[H\x1b[2J\x1b[3Jscratch$ `
    const term = await sameStream(false, stream, 10)
    const stock = await sameStream(undefined, stream, 10)
    expect(bufferLines(term)).toEqual(bufferLines(stock))
    expect(term.buffer.active.length).toBe(stock.buffer.active.length)
    expect(stock.buffer.active.length).toBe(10)
    expect(visibleLines(stock)).toEqual(['scratch$ '])
  })
})
