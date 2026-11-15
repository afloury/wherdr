import { describe, expect, it } from 'vitest'
import { Terminal } from '@xterm/xterm'
import { writeTerminalFrame } from '../app/utils/terminalFrame'

// hc 0.1.16's exact paint of a shell at 103 columns (mode resets trimmed): it ends
// with an absolute cursor move, then bash redraws its prompt after each resize.
const PAINT = '\x1b[H\x1b[2J\x1b[?2004h'
  + 'bash-5.3$ printf \'ICONS-10 abc def ghi\\n\'\r\nICONS-10 abc def ghi\r\n'
  + 'bash-5.3$ echo PLAIN-LINE-ONE-10; echo PLAIN-LINE-TWO-10\r\nPLAIN-LINE-ONE-10\r\nPLAIN-LINE-TWO-10\r\n'
  + 'bash-5.3$ \x1b[6;11H\x1b[0m'
const REDRAW = '\r\x1b[K\rbash-5.3$ '
const bytes = (s: string) => new TextEncoder().encode(s)

// hc's screen at each width (`hc read` joins wrapped rows; these are the rows).
const AT_54 = [
  'bash-5.3$ printf \'ICONS-10 abc def ghi\\n\'',
  'ICONS-10 abc def ghi',
  'bash-5.3$ echo PLAIN-LINE-ONE-10; echo PLAIN-LINE-TWO-',
  '10',
  'PLAIN-LINE-ONE-10',
  'PLAIN-LINE-TWO-10',
  'bash-5.3$',
]
const AT_103 = [AT_54[0], AT_54[1], AT_54[2] + AT_54[3], AT_54[4], AT_54[5], AT_54[6]]

function screen(term: Terminal) {
  return new Promise<{ lines: string[], cursor: [number, number] }>((resolve) => {
    term.write('', () => {
      const b = term.buffer.active
      const lines: string[] = []
      for (let i = 0; i < b.length; i++) lines.push(b.getLine(i)!.translateToString(true).trimEnd())
      while (lines.length && !lines.at(-1)) lines.pop()
      resolve({ lines, cursor: [b.baseY + b.cursorY, b.cursorX] })
    })
  })
}

// The relay's frames when a 54-column screen opens a shell last sized at 103:
// the attach paint at 103, then the resize to 54 and bash's redraw.
function open(term: Terminal) {
  writeTerminalFrame(term, { width: 103, height: 30, reset: true, bytes: bytes('') })
  writeTerminalFrame(term, { width: 103, height: 30, bytes: bytes(PAINT) })
  writeTerminalFrame(term, { width: 54, height: 30, bytes: bytes('') })
  writeTerminalFrame(term, { width: 54, height: 30, bytes: bytes(REDRAW) })
}

describe('writeTerminalFrame', () => {
  it('applies a resize after the paint before it: the screen matches hc at 54 columns, one prompt', async () => {
    const term = new Terminal({ cols: 54, rows: 30, allowProposedApi: true })
    open(term)
    expect(await screen(term)).toEqual({ lines: AT_54, cursor: [6, 10] })
    term.dispose()
  })

  it('widens back to hc\'s screen at 103 columns', async () => {
    const term = new Terminal({ cols: 54, rows: 30, allowProposedApi: true })
    open(term)
    writeTerminalFrame(term, { width: 103, height: 30, bytes: bytes('') })
    writeTerminalFrame(term, { width: 103, height: 30, bytes: bytes(REDRAW) })
    expect(await screen(term)).toEqual({ lines: AT_103, cursor: [5, 10] })
    term.dispose()
  })

  it('reports a size change only when there is one, after the earlier bytes', async () => {
    const term = new Terminal({ cols: 54, rows: 30, allowProposedApi: true })
    const seen: string[] = []
    writeTerminalFrame(term, { width: 54, height: 30, bytes: bytes('x') }, { resized: () => seen.push('same'), written: () => seen.push('x') })
    writeTerminalFrame(term, { width: 80, height: 30, bytes: bytes('') }, { resized: () => seen.push(`resized ${term.cols}`) })
    await screen(term)
    expect(seen).toEqual(['x', 'resized 80'])
    term.dispose()
  })
})
