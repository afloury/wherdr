// Blocking prompts read from Herdr's "detection" screen.
// Fixtures: real screens captured in the test session (claude-ask, claude-idle,
// codex-idle); trust screens rebuilt from their known shape
// (claude-trust, claude-security-guide, codex-trust: the machine already trusts ~).
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { completeOmpAsk, inputVisible, panelOpen, keysFor, parseChoices, parseOmpAsk, pendingOmpAsk, screenChoices } from '../server/utils/choices'

const fx = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')

describe('parseChoices', () => {
  it('reads a Claude AskUserQuestion question (numbered options, descriptions, separator)', () => {
    const c = parseChoices(fx('claude-ask.txt'))
    expect(c).not.toBeNull()
    expect(c!.question).toBe('Quel fruit préfères-tu ?')
    expect(c!.cursor).toBe(0)
    expect(c!.options.map(o => o.label)).toEqual(['Pomme', 'Poire', 'Banane', 'Type something.', 'Chat about this'])
    expect(c!.options[0]!.hint).toBe('Croquante et acidulée')
    expect(c!.options[3]!.hint).toBeNull()
  })

  it('ignores Claude\'s input field when idle (strict mode, used outside blocking)', () => {
    expect(parseChoices(fx('claude-idle.txt'), { strict: true })).toBeNull()
  })

  it('reads Claude\'s folder trust screen', () => {
    const c = parseChoices(fx('claude-trust.txt'))!
    expect(c.question).toBe('Do you trust the files in this folder?')
    expect(c.options.map(o => o.label)).toEqual(['Yes, proceed', 'No, exit'])
  })

  it('reads an unnumbered list (❯ cursor), but not in strict mode', () => {
    const c = parseChoices(fx('claude-security-guide.txt'))!
    expect(c.question).toBe('Security guide')
    expect(c.options.map(o => o.label)).toEqual(['No, exit', 'Yes, I trust this folder'])
    expect(parseChoices(fx('claude-security-guide.txt'), { strict: true })).toBeNull()
  })

  it('reads Codex\'s trust screen (› cursor) even in strict mode', () => {
    const c = parseChoices(fx('codex-trust.txt'), { strict: true })!
    expect(c.question).toMatch(/^Do you trust the contents of this directory\?/)
    expect(c.options.map(o => o.label)).toEqual(['Yes, continue', 'No, quit'])
    expect(c.cursor).toBe(0)
  })

  it('does not take the "› Ask Codex…" field for a question', () => {
    expect(parseChoices(fx('codex-idle.txt'), { strict: true })).toBeNull()
    expect(parseChoices(fx('codex-idle.txt'))).toBeNull()
  })

  it('ignores the diff panel shown to the right of a permission request', () => {
    const c = parseChoices(fx('claude-permission-diff.txt'), { strict: true })!
    expect(c.question).toBe('Do you want to proceed?')
    expect(c.options.map(o => o.label)).toEqual([
      'Yes',
      'Yes, and don\'t ask again for npm test commands',
      'No, and tell Claude what to do differently (esc)',
    ])
    expect(c.options.every(o => o.hint === null)).toBe(true)
    expect(c.cursor).toBe(0)
  })

  it('cuts at the vertical bar of a neighbouring panel, even right against the options', () => {
    const screen = [
      ' Do you want to proceed? │ 12 + <div v-if="ok">',
      ' ❯ 1. Yes                │ 13 +   label="Name"',
      '   2. No                 │ 14 + />',
      '                         │ 15 + >',
    ].join('\n')
    const c = parseChoices(screen)!
    expect(c.question).toBe('Do you want to proceed?')
    expect(c.options.map(o => o.label)).toEqual(['Yes', 'No'])
  })

  it('keeps the aligned descriptions of a list without a neighbouring panel', () => {
    const c = parseChoices('  Pick a size\n\n❯ 1. Small     Quick\n  2. Large     Slow')!
    expect(c.options.map(o => o.label)).toEqual(['Small     Quick', 'Large     Slow'])
  })

  it('refuses a numbered list with a gap', () => {
    expect(parseChoices('Choix ?\n❯ 1. A\n  3. C')).toBeNull()
  })

  it('trouve le curseur au milieu de la liste', () => {
    const c = parseChoices('Quoi ?\n  1. A\n❯ 2. B\n  3. C')!
    expect(c.cursor).toBe(1)
    expect(keysFor(c, 0)).toEqual(['up', 'enter'])
    expect(keysFor(c, 2)).toEqual(['down', 'enter'])
    expect(keysFor(c, 1)).toEqual(['enter'])
  })
})

describe('keysFor', () => {
  it('descend depuis le curseur puis valide', () => {
    const c = parseChoices(fx('claude-ask.txt'))!
    expect(keysFor(c, 2)).toEqual(['down', 'down', 'enter'])
  })
})

describe('inputVisible', () => {
  it('voit le champ de saisie de Claude et de Codex', () => {
    expect(inputVisible(fx('claude-idle.txt'))).toBe(true)
    expect(inputVisible(fx('codex-idle.txt'))).toBe(true)
  })
  it('does not see it when a panel hides it', () => {
    expect(inputVisible('  Usage\n  ████ 40%\n\n  Esc to close')).toBe(false)
  })
  it('does not mistake a menu cursor for the input field', () => {
    expect(inputVisible(fx('claude-trust.txt'))).toBe(false)
    expect(inputVisible(fx('claude-model-1.txt'))).toBe(false)
    expect(inputVisible(' Manage MCP servers\n\n ❯ 1. demo-server · authenticate\n   2. other-server\n\n Esc to cancel')).toBe(false)
  })
})

describe('panelOpen', () => {
  it('closes a full-screen panel but leaves a menu the user may be using', () => {
    expect(panelOpen('  Usage\n  ████ 40%\n\n  Esc to close')).toBe(true)
    expect(panelOpen(fx('claude-trust.txt'))).toBe(false)
    expect(panelOpen(fx('claude-idle.txt'))).toBe(false)
  })
})

describe('parseOmpAsk', () => {
  // Real screens of omp's ask tool (two questions: single choice, checkboxes, then Submit).
  it('reads a single-choice question, without the tabs or "Other"', () => {
    const c = parseOmpAsk(fx('omp-ask-single.txt'))!
    expect(c.question).toBe('Favourite colour?')
    expect(c.options).toEqual([{ label: 'Red', hint: 'warm' }, { label: 'Green', hint: 'calm' }, { label: 'Blue', hint: 'cool' }])
    expect(c.cursor).toBe(0)
    expect(c.multi).toBeUndefined()
    expect(keysFor(c, 2)).toEqual(['down', 'down', 'enter'])
  })

  it('reads checkboxes: checked state, Space to check without confirming', () => {
    const c = parseOmpAsk(fx('omp-ask-multi.txt'))!
    expect(c.question).toBe('Pick sizes')
    expect(c.multi).toBe(true)
    expect(c.options.map(o => [o.label, o.checked])).toEqual([['Small', true], ['Medium', false], ['Large', true]])
    expect(c.cursor).toBe(2)
    expect(keysFor(c, 1)).toEqual(['up', 'space'])
  })

  it('last step: Submit, with the answers', () => {
    const c = parseOmpAsk(fx('omp-ask-review.txt'))!
    expect(c.question).toBe('Review answers')
    expect(c.options).toEqual([{ label: 'Submit', hint: 'color: Red · size: Small, Large' }])
    expect(keysFor(c, 0)).toEqual(['enter'])
  })

  it('nothing without an Ask box; screenChoices picks the reader per agent', () => {
    expect(parseOmpAsk(fx('claude-ask.txt'))).toBeNull()
    expect(screenChoices(fx('omp-ask-single.txt'), 'claude')).toBeNull()
    expect(screenChoices(fx('omp-ask-single.txt'), 'omp')!.options).toHaveLength(3)
  })
})

describe('parseOmpAsk, jeu de symboles ascii', () => {
  it('reads the same box drawn in ascii (> cursor, (o) / [x], + - | borders)', () => {
    const box = [
      '+- Ask -------------------------+',
      '| a    b    Submit              |',
      '| Pick sizes                    |',
      '+-------------------------------+',
      '|   [x] Small                   |',
      '| > [ ] Medium                  |',
      '|   [ ] Other (type your own)   |',
      '+-------------------------------+',
      '| space toggle · enter next     |',
      '+-------------------------------+',
    ].join('\n')
    const c = parseOmpAsk(box)!
    expect(c).toEqual({ question: 'Pick sizes', cursor: 1, multi: true, options: [{ label: 'Small', hint: null, checked: true }, { label: 'Medium', hint: null, checked: false }] })
  })
})

describe('completeOmpAsk', () => {
  // The box folds a long question ("…") and joins its lines; the
  // transcript has the full text of the "ask" call still unanswered.
  const question = 'Plan for titles. Approve?\n\n1. Service: trims the title and writes a system_event.\n2. HTTP: PATCH /title.'
  const call = (id: string, q: string) => JSON.stringify({ type: 'message', message: { role: 'assistant', content: [{ type: 'toolCall', id, name: 'ask', arguments: { questions: [
    { id: 'other', question: 'Email subject?', options: [{ label: 'Keep' }] },
    { id: 'plan', question: q, options: [{ label: 'Approve' }, { label: 'Revise', description: 'Tell me what to change,\nline by line.' }] },
  ] } }] } })
  const box = [
    '╭─ Ask ─────────────────────────────────────╮',
    '│  other    plan    Submit                  │',
    '│ Plan for titles. Approve?1. Service: trims │',
    '│ the title and writes a syst…              │',
    '├───────────────────────────────────────────┤',
    '│ ❯ ○ Approve (Recommended)                 │',
    '│   ○ Revise                                │',
    '│       Tell me what to change,             │',
    '│   ○ Other (type your own)                 │',
    '├───────────────────────────────────────────┤',
    '│ ⏎ select · ↑/↓ move · ⎋ cancel            │',
    '╰───────────────────────────────────────────╯',
  ].join('\n')

  it('takes the full question and descriptions from the pending call', () => {
    const c = completeOmpAsk(parseOmpAsk(box)!, pendingOmpAsk([call('old', 'Stale?'), call('t1', question)]))
    expect(c.question).toBe(question)
    expect(c.options).toEqual([{ label: 'Approve (Recommended)', hint: null }, { label: 'Revise', hint: 'Tell me what to change,\nline by line.' }])
    expect(c.cursor).toBe(0)
  })

  it('keeps the screen if the call already has its answer or carries another question', () => {
    const shown = parseOmpAsk(box)!
    const answered = JSON.stringify({ type: 'message', message: { role: 'toolResult', toolCallId: 't1', toolName: 'ask' } })
    expect(pendingOmpAsk([call('t1', question), answered])).toEqual([])
    expect(completeOmpAsk(shown, pendingOmpAsk([call('t2', 'Something else entirely?')]))).toEqual(shown)
  })
})
