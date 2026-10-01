// Free answer to omp's "Ask" box: a simulated omp (the box, then the text field
// opened by "Other") receives the keys and text sent to Herdr.
import { describe, expect, it } from 'vitest'
import { parseOmpAsk } from '../server/utils/choices'
import { answerFree } from '../server/utils/freeAnswer'
import type { RestartDeps } from '../server/utils/restartSeq'

const OPTIONS = ['Red', 'Green', 'Other (type your own)']

// `prefill`: text already given to "Other" (the reopened field shows it).
// `at`: cursor in the field, at the end of the text by default. `opens`: false =
// omp ignores Enter (field never opens). `expiresAfter`: the question expires
// after that many text sends; the rest goes to omp's main input, where Enter
// sends a message.
function fakeOmp(o: { prefill?: string, open?: boolean, at?: [number, number], opens?: boolean, expiresAfter?: number } = {}) {
  let field = Boolean(o.open)
  let cursor = 0
  const lines = (o.prefill || '').split('\n')
  let [line, col] = o.at || [lines.length - 1, lines[lines.length - 1]!.length]
  let submitted: string | null = null
  let gone = false
  let main = ''
  let texts = 0
  const messages: string[] = []
  const sent: string[] = []
  const insert = (s: string) => {
    lines[line] = lines[line]!.slice(0, col) + s + lines[line]!.slice(col)
    col += s.length
  }
  const key = (k: string) => {
    if (gone) {
      if (k === 'enter') messages.push(main)
      return
    }
    if (submitted !== null) return
    if (!field) {
      if (k === 'down') cursor = Math.min(cursor + 1, OPTIONS.length - 1)
      else if (k === 'up') cursor = Math.max(cursor - 1, 0)
      else if (k === 'enter' && cursor === OPTIONS.length - 1) field = o.opens !== false
      else if (k === 'enter') submitted = OPTIONS[cursor]!
      return
    }
    const cur = lines[line]!
    if (k === 'enter') submitted = lines.join('\n')
    else if (k === 'esc') field = false
    else if (k === 'shift+enter') {
      lines.splice(line, 1, cur.slice(0, col), cur.slice(col))
      line++
      col = 0
    } else if (k === 'ctrl+k') {
      if (col < cur.length) lines[line] = cur.slice(0, col)
      else if (line < lines.length - 1) lines.splice(line, 2, cur + lines[line + 1]!)
    } else if (k === 'ctrl+u') {
      if (col > 0) {
        lines[line] = cur.slice(col)
        col = 0
      } else if (line > 0) {
        col = lines[line - 1]!.length
        lines.splice(line - 1, 2, lines[line - 1]! + cur)
        line--
      }
    }
  }
  const box = (rows: string[]) => ['╭─ Ask ───╮', '│ Favourite colour? │', '├────┤', ...rows.map(r => `│ ${r} │`), '├────┤', '│ ⏎ select │', '╰────╯']
  const screen = () => (gone
    ? ['─'.repeat(20), `❯ ${main}`, '─'.repeat(20)]
    : field
      ? ['╭─ Custom answer: Favourite colour? ──╮', '│ │', ...lines.map((l, i) => `│ ${i ? '  ' : '> '}${l} │`), '│ │', '│ ⏎ or ⌃Q submit  ⎋ cancel │', '│ │', '╰──╯']
      : box(OPTIONS.map((label, i) => `${i === cursor ? '❯' : ' '} ○ ${label}`))).join('\n')
  let t = 0
  const d: RestartDeps = {
    now: () => t,
    sleep: async (ms) => { t += ms },
    call: async (method, params) => {
      if (method === 'pane.read') return { read: { text: screen() } }
      if (params.text !== undefined) {
        sent.push(`text:${params.text}`)
        // Like omp: a typed line break submits the field, Escape closes it.
        for (const part of String(params.text).split(/([\r\n\u001b])/)) {
          if (part === '\n' || part === '\r') key('enter')
          else if (part === '\u001b') key('esc')
          else if (gone) main += part
          else if (submitted === null && field) insert(part)
        }
        if (o.expiresAfter && ++texts >= o.expiresAfter) gone = true
      } else for (const k of params.keys as string[]) {
        sent.push(k)
        key(k)
      }
      return {}
    },
  }
  return { d, screen, sent, messages, result: () => submitted }
}

describe('answerFree', () => {
  it('opens "Other", clears the text already given, types the lines with Shift+Enter then submits', async () => {
    const omp = fakeOmp({ prefill: 'Old answer\non two lines' })
    await answerFree(omp.d, 'w1:p1', parseOmpAsk(omp.screen())!, 2, 'Teal\nwith grey')
    expect(omp.result()).toBe('Teal\nwith grey')
    expect(omp.sent.slice(0, 3)).toEqual(['down', 'down', 'enter'])
  })

  it('field already open, cursor mid-text: nothing to open it, the field is still cleared', async () => {
    const omp = fakeOmp({ open: true, prefill: 'first\nsecond\nthird', at: [1, 3] })
    const shown = parseOmpAsk(omp.screen())!
    expect(shown.typing).toBe(true)
    await answerFree(omp.d, 'w1:p1', shown, 0, 'Blue')
    expect(omp.result()).toBe('Blue')
    expect(omp.sent).not.toContain('down')
  })

  it('field never opens: error, and nothing is typed or submitted', async () => {
    const omp = fakeOmp({ opens: false })
    await expect(answerFree(omp.d, 'w1:p1', parseOmpAsk(omp.screen())!, 2, 'Teal')).rejects.toMatchObject({ code: 'stale' })
    expect(omp.sent).toEqual(['down', 'down', 'enter'])
    expect(omp.result()).toBeNull()
  })

  it('ANSI sequences and control characters removed; a lone \\r is a new line', async () => {
    const omp = fakeOmp()
    await answerFree(omp.d, 'w1:p1', parseOmpAsk(omp.screen())!, 2, 'Teal\rwith \u001b[31mgrey\u001b[0m\u0007')
    expect(omp.result()).toBe('Teal\nwith grey')
  })

  it('one answer at a time per pane', async () => {
    const omp = fakeOmp()
    const first = answerFree(omp.d, 'w1:p1', parseOmpAsk(omp.screen())!, 2, 'Teal')
    await expect(answerFree(omp.d, 'w1:p1', parseOmpAsk(omp.screen())!, 2, 'Blue')).rejects.toMatchObject({ code: 'busy' })
    await first
    expect(omp.result()).toBe('Teal')
  })

  it('question expired while typing: nothing more is typed, Enter sends no message', async () => {
    for (const answer of ['Teal\nwith grey', 'Teal']) {
      const omp = fakeOmp({ expiresAfter: 1 })
      await expect(answerFree(omp.d, 'w1:p1', parseOmpAsk(omp.screen())!, 2, answer)).rejects.toMatchObject({ code: 'stale' })
      expect(omp.sent.slice(3)).toEqual(['text:Teal'])
      expect(omp.messages).toEqual([])
    }
  })
})
