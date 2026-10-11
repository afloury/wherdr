// Long pasted text shown as a card: <pasted_content> parsing, splitting a
// message into the user's words and its pastes, and the message field's send.
import { describe, expect, it } from 'vitest'
import { parseLines } from '../server/utils/transcripts'
import { isLongPaste, looksLikeLog, messageBody, pastedBlocks, splitPasted } from '../shared/pastedText'
import { quoteSegments } from '../app/utils/questionReply'
import { restoreDraft } from '../app/utils/queuedCancel'
import { sentPastes } from '../app/utils/sentPastes'
import { pendingQueue } from '../app/utils/pendingQueue'
import type { DraftAtt } from '../app/composables/useDraft'

const LOG = Array.from({ length: 40 }, (_, i) => `==> Pouring pkg-${i}--1.0.arm64_sonoma.bottle.tar.gz`).join('\n')
// Ten lines written in wherdr's field: quotes of the agent's points, each
// followed by an answer. Long enough to be a card if it were a paste.
const TYPED = Array.from({ length: 5 }, (_, i) =>
  `> Point ${i + 1}: ${'the agent explains what it found and what it suggests. '.repeat(6).trim()}\nAnswer ${i + 1}: agreed, go ahead with that one.`).join('\n')
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

  it('lists nothing when the blocks are the whole message (a wherdr send)', () => {
    expect(pastedBlocks(`<pasted_content id="a1">\n${TYPED}\n</pasted_content id="a1">`)).toEqual([])
    expect(pastedBlocks(`[Image #1] <pasted_content id="a1">\n${LOG}\n</pasted_content id="a1">\n`)).toEqual([])
  })

  it('marks the pasted blocks of a Claude user message, text unchanged', () => {
    const items = parseLines([
      claudeLine(`Why does it fail?\n\n<pasted_content id="37d4">\n${LOG}\n</pasted_content id="37d4">`),
      claudeLine([{ type: 'text', text: `See:\n<pasted_content id="9">\n${LOG}\n</pasted_content id="9">` }]),
      claudeLine('<pasted_content id="1">\nline one\nline two\n</pasted_content id="1">'),
    ].join('\n'), 'claude', 0, '/home/user').filter(i => i.role === 'user')
    expect(items.map(i => i.text)).toEqual([`Why does it fail?\n\n${LOG}`, `See:\n${LOG}`, 'line one\nline two'])
    expect(items.map(i => i.pasted)).toEqual([[LOG], [LOG], undefined])
  })

  it('keeps a long message typed in wherdr a plain message, quotes and all', () => {
    expect(TYPED.split('\n')).toHaveLength(10)
    expect(isLongPaste(TYPED)).toBe(true)
    const wrapped = `<pasted_content id="c3">\n${TYPED}\n</pasted_content id="c3">`
    const items = parseLines([
      claudeLine(wrapped),
      claudeLine([{ type: 'text', text: wrapped }]),
      // Taken during the turn, and grouped with a one-line message.
      JSON.stringify({ type: 'attachment', timestamp: '2026-10-08T08:00:00.000Z', attachment: { type: 'queued_command', commandMode: 'prompt', origin: { kind: 'human' }, prompt: wrapped } }),
      claudeLine([{ type: 'text', text: 'ok' }, { type: 'text', text: wrapped }]),
    ].join('\n'), 'claude', 0, '/home/user').filter(i => i.role === 'user')
    expect(items.map(i => i.text)).toEqual([TYPED, TYPED, TYPED, `ok\n${TYPED}`])
    expect(items.map(i => i.pasted)).toEqual([undefined, undefined, undefined, undefined])
    // Shown whole, its "> " lines as quotes; no card.
    expect(splitPasted(items[0]!.text, items[0]!.pasted, [])).toEqual({ text: TYPED, pastes: [] })
    expect(quoteSegments(TYPED).filter(s => s.quote)).toHaveLength(5)
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

  it('never guesses a paste inside a block: a short paragraph, a blank line, long text stays text', () => {
    const whole = `fix this\nplease\n\n${LOG}`
    expect(splitPasted(whole, [], [])).toEqual({ text: whole, pastes: [] })
    const typed = `> Point 1\nYes.\n\n${TYPED}`
    expect(splitPasted(typed, [], [LOG])).toEqual({ text: typed, pastes: [] })
  })

  it('cuts a block the server clipped up to the end: the card is what the message holds', () => {
    const text = `see\n${LOG.slice(0, 900)}…`
    expect(splitPasted(text, [LOG])).toEqual({ text: 'see', pastes: [LOG.slice(0, 900)] })
    // A whole message that starts like the block does not hold it.
    expect(splitPasted(`see\n${LOG.slice(0, 900)}`, [LOG])).toEqual({ text: `see\n${LOG.slice(0, 900)}`, pastes: [] })
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
    // Long typed words with a real paste: the words stay a message, the paste is the card.
    expect(splitPasted(messageBody(TYPED, [LOG], []), [], [LOG])).toEqual({ text: TYPED, pastes: [LOG] })
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

  it('puts back as a card a pasted text another device sent', () => {
    const draft: { text: string, atts: DraftAtt[] } = { text: '', atts: [] }
    restoreDraft(draft, `fix this\n\n${LOG}`, [LOG])
    expect(draft.text).toBe('fix this')
    expect(draft.atts).toEqual([{ url: '', path: null, paste: LOG }])
  })
})

describe('queued bubble', () => {
  it('carries the pasted texts the server lists', () => {
    const [q] = pendingQueue({ mine: [{ id: 'w-1', text: `fix this\n\n${LOG}`, at: 1, pasted: [LOG] }], claude: [], items: [], screen: null })
    expect(q!.pasted).toEqual([LOG])
    const [plain] = pendingQueue({ mine: [{ id: 'w-2', text: 'hello', at: 1 }], claude: [], items: [], screen: null })
    expect(plain).not.toHaveProperty('pasted')
  })
})
