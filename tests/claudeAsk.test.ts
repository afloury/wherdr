// Claude Code's AskUserQuestion box as a choice card.
// Fixtures: claude-ask-bar, claude-ask-window and claude-ask-typed are real
// screens of Claude Code 2.1 (Herdr test session; the window ones in a short
// pane); claude-ask-long rebuilds the shape of a user report (question wrapped
// without the "│" bar, descriptions on several lines); claude-ask.jsonl is a
// made-up transcript with the pending call behind those screens.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { Choices } from '../shared/types'
import { CLAUDE_CHAT, CLAUDE_FREE, completeClaudeAsk, keysFor, parseChoices, pendingClaudeAsk, screenChoices } from '../server/utils/choices'
import { answerFree } from '../server/utils/freeAnswer'

const fx = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')
const asked = () => pendingClaudeAsk(fx('claude-ask.jsonl').split('\n'))
const QUESTION = 'How would you prefer to store and manage your data in your project? Consider factors like data persistence, performance characteristics, ease of implementation, scalability requirements, and maintenance overhead. Which approach best aligns with your project\'s needs and constraints?'

describe('parseChoices on AskUserQuestion', () => {
  it('reads the reported screen: wrapped question, multi-line descriptions, free answer, separator', () => {
    const c = parseChoices(fx('claude-ask-long.txt'))!
    expect(c.question).toBe('Which of these approaches should the next thread take for the storage layer, given that the cache already holds most of the data and the sync job runs every five minutes?')
    expect(c.cursor).toBe(0)
    expect(c.options.map(o => o.label)).toEqual(['Keep the current cache (Recommended)', 'Move everything to the database', 'Split by data type', CLAUDE_FREE, CLAUDE_CHAT])
    expect(c.options[0]!.hint).toBe('Smallest change: the cache stays the single source of truth and the sync job only fills the gaps it finds.')
    expect(c.options[3]).toMatchObject({ free: true, hint: null, n: 4 })
    expect(c.options[4]!.free).toBeUndefined()
    // Herdr sees Claude as blocked: strict or not, the same card.
    expect(parseChoices(fx('claude-ask-long.txt'), { strict: true })).toEqual(c)
  })

  it('reads the question behind Claude\'s "│" bar', () => {
    const c = parseChoices(fx('claude-ask-bar.txt'))!
    expect(c.question).toBe(QUESTION)
    expect(c.options.map(o => o.n)).toEqual([1, 2, 3, 4, 5])
    expect(c.options[2]!.hint).toBe('Use a SQL or NoSQL database for data storage. Provides robust persistence, advanced querying capabilities, transaction support, and excellent scalability. More complex setup but handles large datasets and concurrent access reliably. Production-grade approach.')
  })

  it('reads a window on the options (short pane): numbers with gaps', () => {
    const c = parseChoices(fx('claude-ask-window.txt'))!
    expect(c.options.map(o => [o.n, o.label])).toEqual([[1, 'In-Memory Storage'], [5, CLAUDE_CHAT]])
    expect(c.cursor).toBe(0)
    // Keys counted on the numbers: 4 options further down.
    expect(keysFor(c, 1)).toEqual(['down', 'down', 'down', 'down', 'enter'])
  })

  it('reads the ↑ marker and the text typed in place of "Type something."', () => {
    const c = parseChoices(fx('claude-ask-typed.txt'))!
    expect(c.options.map(o => o.n)).toEqual([2, 3, 4, 5])
    expect(c.options[2]).toMatchObject({ label: CLAUDE_FREE, hint: 'Mixed approach', free: true })
    expect(c.cursor).toBe(2)
  })

  it('still refuses a numbering that goes back (history above a list)', () => {
    expect(parseChoices(['  3. Old item', '  4. Old item', '', '❯ 1. Yes', '  2. No'].join('\n'))).toBeNull()
    expect(parseChoices(['❯ 2. Yes', '  1. No'].join('\n'))).toBeNull()
  })
})

describe('pendingClaudeAsk / completeClaudeAsk', () => {
  it('keeps only the unanswered call, with every question', () => {
    const a = asked()
    expect(a.map(q => q.question)).toEqual([QUESTION, 'Which extras should be enabled?'])
    expect(a.map(q => q.multi)).toEqual([false, true])
  })

  it('fills the options hidden by a window, with their whole descriptions', () => {
    const c = completeClaudeAsk(parseChoices(fx('claude-ask-window.txt'))!, asked())
    expect(c.question).toBe(QUESTION)
    expect(c.options.map(o => o.label)).toEqual(['In-Memory Storage', 'File-Based Storage', 'Database', CLAUDE_FREE, CLAUDE_CHAT])
    expect(c.options.map(o => o.n)).toEqual([1, 2, 3, 4, 5])
    expect(c.options[3]!.free).toBe(true)
    expect(c.options[1]!.hint).toMatch(/^Persist data to files on disk/)
    expect(c.cursor).toBe(0)
    expect(keysFor(c, 2)).toEqual(['down', 'down', 'enter'])
  })

  it('keeps the cursor and the typed text of a window further down', () => {
    const c = completeClaudeAsk(parseChoices(fx('claude-ask-typed.txt'))!, asked())
    expect(c.cursor).toBe(3)
    expect(c.options[3]).toMatchObject({ label: CLAUDE_FREE, hint: 'Mixed approach', free: true })
    expect(keysFor(c, 0)).toEqual(['up', 'up', 'up', 'enter'])
  })

  it('leaves the screen as read when the options are not those of the call', () => {
    const shown = parseChoices(fx('claude-ask-long.txt'))!
    expect(completeClaudeAsk(shown, asked())).toBe(shown)
    expect(completeClaudeAsk(shown, [])).toBe(shown)
  })

  it('completes the screen re-read before answering, for Claude only', () => {
    expect(screenChoices(fx('claude-ask-window.txt'), 'claude', asked())!.options).toHaveLength(5)
    expect(screenChoices(fx('claude-ask-window.txt'), 'codex', asked())!.options).toHaveLength(2)
  })

  it('still reads the earlier AskUserQuestion fixture', () => {
    const c = screenChoices(fx('claude-ask.txt'), 'claude', [])!
    expect(c.options.map(o => o.label)).toEqual(['Pomme', 'Poire', 'Banane', CLAUDE_FREE, CLAUDE_CHAT])
    expect(c.options[3]!.free).toBe(true)
  })
})

describe('answerFree for Claude', () => {
  // Fake pane: the screen follows the keys and the text received.
  function pane(screen: (cursor: number, typed: string) => string, start: { cursor: number, typed: string }) {
    const sent: unknown[] = []
    const s = { ...start }
    let t = 0
    const call = async (method: string, p: Record<string, unknown>) => {
      if (method === 'pane.read') return { read: { text: screen(s.cursor, s.typed) } }
      sent.push(p.keys || { text: p.text })
      for (const k of (p.keys as string[] | undefined) || []) {
        if (k === 'down') s.cursor++
        else if (k === 'up') s.cursor--
        else if (k === 'ctrl+u' && s.cursor === 3) s.typed = ''
      }
      if (typeof p.text === 'string' && s.cursor === 3) s.typed += p.text
      return {}
    }
    return { sent, d: { call, sleep: async () => { t += 100 }, now: () => t } }
  }
  const labels = ['In-Memory Storage', 'File-Based Storage', 'Database']
  const screen = (cursor: number, typed: string) => [
    '│ Which approach best aligns with your needs?',
    '',
    ...[...labels, typed || CLAUDE_FREE].map((l, i) => `${i === cursor ? '❯' : ' '} ${i + 1}. ${l}`),
    '─'.repeat(40),
    `${cursor === 4 ? '❯' : ' '} 5. ${CLAUDE_CHAT}`,
    '',
    'Enter to select · ↑/↓ to navigate · Esc to cancel',
  ].join('\n')

  it('moves to the field without Enter, clears it, types one line, then submits', async () => {
    const { sent, d } = pane(screen, { cursor: 0, typed: 'old draft' })
    const c = parseChoices(screen(0, 'old draft'))! as Choices
    await answerFree(d, 'w1:p1', c, 3, 'Mixed\napproach', 'claude')
    expect(sent).toEqual([['down', 'down', 'down'], ['ctrl+u'], { text: 'Mixed approach' }, ['enter']])
  })

  it('submits nothing when the text does not show in the field', async () => {
    const { sent, d } = pane((cursor, typed) => screen(cursor, typed && 'something else'), { cursor: 3, typed: '' })
    const c = parseChoices(screen(3, ''))!
    await expect(answerFree(d, 'w1:p1', c, 3, 'Mixed approach', 'claude')).rejects.toThrow(/not submitted/)
    expect(sent).not.toContainEqual(['enter'])
  })
})

describe('AskUserQuestion with several questions', () => {
  it('reads the single-choice tab under the tab header', () => {
    const c = parseChoices(fx('claude-ask-tabs-1.txt'))!
    expect(c.question).toBe('What is your favourite colour?')
    expect(c.options.map(o => o.label)).toEqual(['Red', 'Green', 'Blue', CLAUDE_FREE, CLAUDE_CHAT])
    expect(c.multi).toBeUndefined()
    expect(keysFor(c, 1)).toEqual(['down', 'enter'])
  })

  it('reads checkboxes, with Submit in its place in the list', () => {
    const c = parseChoices(fx('claude-ask-tabs-2.txt'))!
    expect(c.multi).toBe(true)
    expect(c.question).toBe('Which pets do you like?')
    expect(c.options.map(o => [o.label, o.checked, o.n])).toEqual([
      ['Cat', false, 1], ['Dog', false, 2], ['Fish', false, 3], [CLAUDE_FREE, false, 4], ['Submit', undefined, 5], [CLAUDE_CHAT, undefined, 6],
    ])
    expect(c.options[3]).toMatchObject({ hint: null, free: true })
    // A box is toggled with Space, Submit and Chat are confirmed with Enter.
    expect(keysFor(c, 1)).toEqual(['down', 'space'])
    expect(keysFor(c, 4)).toEqual(['down', 'down', 'down', 'down', 'enter'])
    expect(keysFor(c, 5)).toEqual(['down', 'down', 'down', 'down', 'down', 'enter'])
  })

  it('keeps the card with the cursor on Submit, and the boxes ticked', () => {
    const c = parseChoices(fx('claude-ask-tabs-submit.txt'))!
    expect(c.options[c.cursor]!.label).toBe('Submit')
    expect(c.options.filter(o => o.checked).map(o => o.label)).toEqual(['Cat', 'Dog'])
    expect(keysFor(c, 2)).toEqual(['up', 'up', 'space'])
    expect(keysFor(c, c.cursor)).toEqual(['enter'])
  })

  it('leaves checkboxes as read (no completion from the call)', () => {
    const c = parseChoices(fx('claude-ask-tabs-2.txt'))!
    expect(completeClaudeAsk(c, asked())).toBe(c)
  })
})

describe('AskUserQuestion review step', () => {
  it('shows the answers under "Submit answers"', () => {
    const c = parseChoices(fx('claude-ask-tabs-review.txt'))!
    expect(c.question).toBe('Ready to submit your answers?')
    expect(c.options.map(o => o.label)).toEqual(['Submit answers', 'Cancel'])
    expect(c.options[0]!.hint).toBe('Green · Cat, Dog, Fish')
  })
})

// One multiSelect question alone (the reported case): real screens of Claude
// Code 2.1.287 (Herdr test session, made-up content), a normal pane, a short one,
// a free answer typed in place, and claude-ask-multi.jsonl behind them.
describe('AskUserQuestion with a single multiSelect question', () => {
  const fruits = () => pendingClaudeAsk(fx('claude-ask-multi.jsonl').split('\n'))

  it('reads the whole box: boxes, free answer, Submit, Chat about this', () => {
    const c = parseChoices(fx('claude-ask-multi.txt'))!
    expect(c.multi).toBe(true)
    expect(c.question).toBe('Which fruits should go in the salad?')
    expect(c.options.map(o => [o.n, o.label, o.checked])).toEqual([
      [1, 'Apple', false], [2, 'Banana', false], [3, 'Mango', false], [4, 'Kiwi', false],
      [5, CLAUDE_FREE, false], [6, 'Submit', undefined], [7, CLAUDE_CHAT, undefined],
    ])
    expect(c.options[0]!.hint).toBe('Crisp and sweet')
    expect(c.options[4]!.free).toBe(true)
    expect(parseChoices(fx('claude-ask-multi.txt'), { strict: true })).toEqual(c)
    expect(keysFor(c, 2)).toEqual(['down', 'down', 'space'])
    expect(keysFor(c, 5)).toEqual(['down', 'down', 'down', 'down', 'down', 'enter'])
  })

  it('numbers Submit after the options hidden by a window (short pane)', () => {
    const c = parseChoices(fx('claude-ask-multi-window.txt'))!
    expect(c.options.map(o => [o.n, o.label])).toEqual([[1, 'Apple'], [2, 'Banana'], [6, 'Submit'], [7, CLAUDE_CHAT]])
    expect(keysFor(c, 2)).toEqual(['down', 'down', 'down', 'down', 'down', 'enter'])
  })

  it('completes a window from the pending call, keeping ticks seen earlier', () => {
    const checks = new Map()
    const full = parseChoices(fx('claude-ask-multi.txt'))!
    // Mango ticked while it was on screen…
    completeClaudeAsk({ ...full, options: full.options.map(o => (o.label === 'Mango' ? { ...o, checked: true } : o)) }, fruits(), checks)
    // …then the pane got short: Mango is hidden.
    const c = completeClaudeAsk(parseChoices(fx('claude-ask-multi-window.txt'))!, fruits(), checks)
    expect(c.multi).toBe(true)
    expect(c.options.map(o => [o.n, o.label, o.checked])).toEqual([
      [1, 'Apple', false], [2, 'Banana', false], [3, 'Mango', true], [4, 'Kiwi', false],
      [5, CLAUDE_FREE, false], [6, 'Submit', undefined], [7, CLAUDE_CHAT, undefined],
    ])
    expect(c.options[3]!.hint).toBe('Tangy and bright')
    expect(c.options[4]!.free).toBe(true)
    expect(c.cursor).toBe(0)
    expect(keysFor(c, 3)).toEqual(['down', 'down', 'down', 'space'])
  })

  it('completes a window with the cursor on the free answer', () => {
    const c = completeClaudeAsk(parseChoices(fx('claude-ask-multi-window-free.txt'))!, fruits())
    expect(c.options).toHaveLength(7)
    expect(c.cursor).toBe(4)
    expect(c.options[c.cursor]).toMatchObject({ label: CLAUDE_FREE, free: true, checked: false })
  })

  it('reads the text typed in place of "Type something", ticked', () => {
    const c = parseChoices(fx('claude-ask-multi-typed.txt'))!
    expect(c.options[c.cursor]).toMatchObject({ n: 5, label: CLAUDE_FREE, hint: 'Pretzels', checked: true, free: true })
  })

  it('shows the answers of the review step', () => {
    const c = parseChoices(fx('claude-ask-multi-review.txt'))!
    expect(c.options.map(o => o.label)).toEqual(['Submit answers', 'Cancel'])
    expect(c.options[0]!.hint).toBe('Chips, Lemonade')
  })

  it('types a free answer among checkboxes without Enter (it would untick it)', async () => {
    const s = { cursor: 0, typed: '' }
    const sent: unknown[] = []
    const screen = () => [
      'Which fruits should go in the salad?',
      '',
      ...['Apple', 'Banana'].map((l, i) => `${i === s.cursor ? '❯' : ' '} ${i + 1}. [ ] ${l}`),
      `${s.cursor === 2 ? '❯' : ' '} 3. [${s.typed ? '✔' : ' '}] ${s.typed || 'Type something'}`,
      `${s.cursor === 3 ? '❯' : ' '}    Submit`,
      '─'.repeat(40),
      `${s.cursor === 4 ? '❯' : ' '} 4. ${CLAUDE_CHAT}`,
    ].join('\n')
    let t = 0
    const d = {
      call: async (method: string, p: Record<string, unknown>) => {
        if (method === 'pane.read') return { read: { text: screen() } }
        sent.push(p.keys || { text: p.text })
        for (const k of (p.keys as string[] | undefined) || []) if (k === 'down') s.cursor++
        if (typeof p.text === 'string' && s.cursor === 2) s.typed += p.text
        return {}
      },
      sleep: async () => { t += 100 },
      now: () => t,
    }
    const c = parseChoices(screen())!
    expect(c.options[2]).toMatchObject({ free: true, checked: false })
    await answerFree(d, 'w1:p1', c, 2, 'Pear', 'claude')
    expect(sent).toEqual([['down', 'down'], { text: 'Pear' }])
  })
})

// A tall pane (herdr-projects coordinator, 77 rows) keeps the agent's previous
// replies on screen above the box: a numbered list there, at the column of the
// options, used to be taken for options and the whole box was rejected.
// Real Claude Code 2.1.287 screens at 105 columns, made-up content.
describe('AskUserQuestion below a numbered list in an earlier reply', () => {
  it('reads only the box of the first question tab', () => {
    const c = parseChoices(fx('claude-ask-history-tabs.txt'))!
    expect(c.question).toBe('Test 1 (single choice): which colour do you prefer? Also try « Type something » for a free answer.')
    expect(c.options.map(o => [o.n, o.label])).toEqual([[1, 'Blue'], [2, 'Green'], [3, 'Red'], [4, CLAUDE_FREE], [5, CLAUDE_CHAT]])
    expect(c.options[0]!.hint).toBe('Test option A')
    expect(parseChoices(fx('claude-ask-history-tabs.txt'), { strict: true })).toEqual(c)
  })

  it('reads a single multiSelect box with the list further up', () => {
    const c = parseChoices(fx('claude-ask-history-multi.txt'))!
    expect(c.multi).toBe(true)
    expect(c.question).toBe('Which fruits do you like?')
    expect(c.options.map(o => [o.n, o.label])).toEqual([
      [1, 'Apple'], [2, 'Banana'], [3, 'Mango'], [4, 'Kiwi'], [5, CLAUDE_FREE], [6, 'Submit'], [7, CLAUDE_CHAT],
    ])
  })

  it('ignores a list introduced by a sentence, every item at the option column', () => {
    const text = fx('claude-ask-history-tabs.txt').replace('● 1. Pick', '● Plan for the garden:\n  1. Pick')
    const c = parseChoices(text)!
    expect(c.options.map(o => o.label)).toEqual(['Blue', 'Green', 'Red', CLAUDE_FREE, CLAUDE_CHAT])
  })

  it('still reads a list right under its question', () => {
    const text = 'Pick one\n\n  1. Alpha\n❯ 2. Beta\n  3. Gamma\n\nEnter to select · ↑/↓ to navigate · Esc to cancel'
    expect(parseChoices(text)!.options.map(o => o.label)).toEqual(['Alpha', 'Beta', 'Gamma'])
  })
})
