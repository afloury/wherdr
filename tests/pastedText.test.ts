// Long pasted text shown as a card: <pasted_content> parsing, splitting a
// message into the user's words and its pastes, and the message field's send.
import { describe, expect, it } from 'vitest'
import { parseLines } from '../server/utils/transcripts'
import { isLongPaste, looksLikeLog, messageBody, pastedBlocks, splitPasted } from '../shared/pastedText'
import { restoreDraft } from '../app/utils/queuedCancel'
import { sentPastes } from '../app/utils/sentPastes'
import type { DraftAtt } from '../app/composables/useDraft'

const LOG = Array.from({ length: 40 }, (_, i) => `==> Pouring pkg-${i}--1.0.arm64_sonoma.bottle.tar.gz`).join('\n')
const claudeLine = (content: unknown, ts = '2026-10-08T08:00:00.000Z') =>
  JSON.stringify({ type: 'user', timestamp: ts, message: { role: 'user', content } })

describe('long paste threshold', () => {
  it('turns more than 12 lines or 1500 characters into a card', () => {
    expect(isLongPaste(Array(12).fill('a').join('\n'))).toBe(false)
    expect(isLongPaste(Array(13).fill('a').join('\n'))).toBe(true)
    expect(isLongPaste('x'.repeat(1500))).toBe(false)
    expect(isLongPaste('x'.repeat(1501))).toBe(true)
    // Blank lines around the paste do not count.
    expect(isLongPaste(`\n\n\n${Array(12).fill('a').join('\n')}\n\n\n`)).toBe(false)
  })
})

describe('<pasted_content> blocks', () => {
  it('lists long blocks only, with or without words around, several blocks', () => {
    const raw = `Look at this:\n<pasted_content id="a1">\n${LOG}\n</pasted_content id="a1">\nand this one\n<pasted_content id="b2">\nshort\nblock\n</pasted_content id="b2">\n<pasted_content>\n${LOG}x\n</pasted_content>`
    expect(pastedBlocks(raw)).toEqual([LOG, `${LOG}x`])
    expect(pastedBlocks(LOG)).toEqual([])
  })

  it('marks the pasted blocks of a Claude user message, text unchanged', () => {
    const items = parseLines([
      claudeLine(`Why does it fail?\n\n<pasted_content id="37d4">\n${LOG}\n</pasted_content id="37d4">`),
      claudeLine([{ type: 'text', text: `<pasted_content id="9">\n${LOG}\n</pasted_content id="9">` }]),
      claudeLine('<pasted_content id="1">\nline one\nline two\n</pasted_content id="1">'),
    ].join('\n'), 'claude', 0, '/home/user').filter(i => i.role === 'user')
    expect(items.map(i => i.text)).toEqual([`Why does it fail?\n\n${LOG}`, LOG, 'line one\nline two'])
    expect(items.map(i => i.pasted)).toEqual([[LOG], [LOG], undefined])
  })
})

describe('splitting a user message', () => {
  it('keeps the words around listed blocks, in order', () => {
    const other = LOG.replace(/Pouring/g, 'Fetching')
    const s = splitPasted(`Before\n\n${LOG}\n\nbetween\n${other}\nafter`, [other, LOG])
    expect(s).toEqual({ text: 'Before\nbetween\nafter', pastes: [LOG, other] })
  })

  it('finds blocks this device sent in plain text (Codex, omp)', () => {
    expect(splitPasted(`fix this\n\n${LOG}`, [], [LOG])).toEqual({ text: 'fix this', pastes: [LOG] })
    // Not long: a short known text stays text.
    expect(splitPasted('ok\n\nshort', [], ['short'])).toEqual({ text: 'ok\n\nshort', pastes: [] })
  })

  it('leaves typed words out of a wherdr send Claude wrapped whole', () => {
    const whole = `fix this\n\n${LOG}`
    expect(splitPasted(whole, [whole], [LOG])).toEqual({ text: 'fix this', pastes: [LOG] })
  })

  it('splits a wherdr send from another device: short paragraph, blank line, long text', () => {
    const whole = `fix this\nplease\n\n${LOG}`
    expect(splitPasted(whole, [whole])).toEqual({ text: 'fix this\nplease', pastes: [LOG] })
    // A long first paragraph is part of the paste.
    const prose = `${'a long first paragraph '.repeat(30)}\n\n${LOG}`
    expect(splitPasted(prose, [prose]).pastes).toEqual([prose])
  })

  it('cuts a block the server clipped up to the end', () => {
    const text = `see\n${LOG.slice(0, 900)}…`
    expect(splitPasted(text, [LOG])).toEqual({ text: 'see', pastes: [LOG] })
  })

  it('keeps the text when nothing matches', () => {
    expect(splitPasted('hello', [LOG], [LOG])).toEqual({ text: 'hello', pastes: [] })
  })
})

describe('monospace for logs', () => {
  it('tells a log from prose', () => {
    expect(looksLikeLog(LOG)).toBe(true)
    expect(looksLikeLog('Error: x\n  at foo (src/a.ts:12:3)\n  at bar (src/b.ts:4:1)')).toBe(true)
    expect(looksLikeLog(Array(20).fill('This is a plain sentence about the design of the app, nothing more.').join('\n'))).toBe(false)
  })
})

describe('send from the message field', () => {
  it('sends the typed text, the pasted texts as they are, then the paths', () => {
    const paste = '  indented\n\tline\n'
    expect(messageBody(' fix this ', [LOG, paste], ['@/tmp/a.txt'])).toBe(`fix this\n\n${LOG}\n\n${paste}\n@/tmp/a.txt`)
    // A paste alone: no blank line before it.
    expect(messageBody('', [LOG], [])).toBe(LOG)
    // The conversation shows the typed words and the card back.
    expect(splitPasted(messageBody('fix this', [LOG], []), [], [LOG])).toEqual({ text: 'fix this', pastes: [LOG] })
  })
})

describe('cancelled message back into the field', () => {
  it('puts a pasted text back as a card', () => {
    sentPastes.value = [LOG]
    const draft: { text: string, atts: DraftAtt[] } = { text: '', atts: [] }
    restoreDraft(draft, `fix this\n\n${LOG}`)
    expect(draft.text).toBe('fix this')
    expect(draft.atts).toEqual([{ url: '', path: null, paste: LOG }])
    sentPastes.value = []
  })
})
