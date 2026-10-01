// Invites bloquantes lues sur l'écran « detection » de Herdr.
// Fixtures : écrans réels capturés dans la session de test (claude-ask, claude-idle,
// codex-idle) ; écrans de confiance reconstitués d'après leur forme connue
// (claude-trust, claude-security-guide, codex-trust : la machine fait déjà confiance à ~).
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { completeOmpAsk, inputVisible, panelOpen, keysFor, parseChoices, parseOmpAsk, pendingOmpAsk, screenChoices } from '../server/utils/choices'

const fx = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')

describe('parseChoices', () => {
  it('lit une question AskUserQuestion de Claude (options numérotées, descriptions, séparateur)', () => {
    const c = parseChoices(fx('claude-ask.txt'))
    expect(c).not.toBeNull()
    expect(c!.question).toBe('Quel fruit préfères-tu ?')
    expect(c!.cursor).toBe(0)
    expect(c!.options.map(o => o.label)).toEqual(['Pomme', 'Poire', 'Banane', 'Type something.', 'Chat about this'])
    expect(c!.options[0]!.hint).toBe('Croquante et acidulée')
    expect(c!.options[3]!.hint).toBeNull()
  })

  it('ignore le champ de saisie de Claude au repos (mode strict, utilisé hors blocage)', () => {
    expect(parseChoices(fx('claude-idle.txt'), { strict: true })).toBeNull()
  })

  it('lit l’écran de confiance du dossier de Claude', () => {
    const c = parseChoices(fx('claude-trust.txt'))!
    expect(c.question).toBe('Do you trust the files in this folder?')
    expect(c.options.map(o => o.label)).toEqual(['Yes, proceed', 'No, exit'])
  })

  it('lit une liste sans numéros (curseur ❯), mais pas en mode strict', () => {
    const c = parseChoices(fx('claude-security-guide.txt'))!
    expect(c.question).toBe('Security guide')
    expect(c.options.map(o => o.label)).toEqual(['No, exit', 'Yes, I trust this folder'])
    expect(parseChoices(fx('claude-security-guide.txt'), { strict: true })).toBeNull()
  })

  it('lit l’écran de confiance de Codex (curseur ›) même en mode strict', () => {
    const c = parseChoices(fx('codex-trust.txt'), { strict: true })!
    expect(c.question).toMatch(/^Do you trust the contents of this directory\?/)
    expect(c.options.map(o => o.label)).toEqual(['Yes, continue', 'No, quit'])
    expect(c.cursor).toBe(0)
  })

  it('ne prend pas le champ « › Ask Codex… » pour une question', () => {
    expect(parseChoices(fx('codex-idle.txt'), { strict: true })).toBeNull()
    expect(parseChoices(fx('codex-idle.txt'))).toBeNull()
  })

  it('ignore le panneau diff affiché à droite d’une demande de permission', () => {
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

  it('coupe au trait vertical d’un panneau voisin, même collé aux options', () => {
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

  it('garde les descriptions alignées d’une liste sans panneau voisin', () => {
    const c = parseChoices('  Pick a size\n\n❯ 1. Small     Quick\n  2. Large     Slow')!
    expect(c.options.map(o => o.label)).toEqual(['Small     Quick', 'Large     Slow'])
  })

  it('refuse une liste numérotée avec un trou', () => {
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
  it('ne le voit pas quand un panneau le cache', () => {
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
  // Écrans réels de l'outil ask d'omp (deux questions : choix unique, cases à cocher, puis Submit).
  it('lit une question à choix unique, sans les onglets ni « Other »', () => {
    const c = parseOmpAsk(fx('omp-ask-single.txt'))!
    expect(c.question).toBe('Favourite colour?')
    expect(c.options).toEqual([{ label: 'Red', hint: 'warm' }, { label: 'Green', hint: 'calm' }, { label: 'Blue', hint: 'cool' }])
    expect(c.cursor).toBe(0)
    expect(c.multi).toBeUndefined()
    expect(keysFor(c, 2)).toEqual(['down', 'down', 'enter'])
  })

  it('lit des cases à cocher : état coché, Espace pour cocher sans valider', () => {
    const c = parseOmpAsk(fx('omp-ask-multi.txt'))!
    expect(c.question).toBe('Pick sizes')
    expect(c.multi).toBe(true)
    expect(c.options.map(o => [o.label, o.checked])).toEqual([['Small', true], ['Medium', false], ['Large', true]])
    expect(c.cursor).toBe(2)
    expect(keysFor(c, 1)).toEqual(['up', 'space'])
  })

  it('dernière étape : Submit, avec les réponses', () => {
    const c = parseOmpAsk(fx('omp-ask-review.txt'))!
    expect(c.question).toBe('Review answers')
    expect(c.options).toEqual([{ label: 'Submit', hint: 'color: Red · size: Small, Large' }])
    expect(keysFor(c, 0)).toEqual(['enter'])
  })

  it('rien sans boîte Ask ; screenChoices choisit le lecteur selon l’agent', () => {
    expect(parseOmpAsk(fx('claude-ask.txt'))).toBeNull()
    expect(screenChoices(fx('omp-ask-single.txt'), 'claude')).toBeNull()
    expect(screenChoices(fx('omp-ask-single.txt'), 'omp')!.options).toHaveLength(3)
  })
})

describe('parseOmpAsk, jeu de symboles ascii', () => {
  it('lit la même boîte dessinée en ascii (curseur >, (o) / [x], bords + - |)', () => {
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
  // La boîte replie une longue question (« … ») et colle ses lignes ; la
  // transcription a le texte entier de l'appel « ask » encore sans réponse.
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

  it('reprend la question et les descriptions entières de l’appel en attente', () => {
    const c = completeOmpAsk(parseOmpAsk(box)!, pendingOmpAsk([call('old', 'Stale?'), call('t1', question)]))
    expect(c.question).toBe(question)
    expect(c.options).toEqual([{ label: 'Approve (Recommended)', hint: null }, { label: 'Revise', hint: 'Tell me what to change,\nline by line.' }])
    expect(c.cursor).toBe(0)
  })

  it('garde l’écran si l’appel a déjà sa réponse ou porte une autre question', () => {
    const shown = parseOmpAsk(box)!
    const answered = JSON.stringify({ type: 'message', message: { role: 'toolResult', toolCallId: 't1', toolName: 'ask' } })
    expect(pendingOmpAsk([call('t1', question), answered])).toEqual([])
    expect(completeOmpAsk(shown, pendingOmpAsk([call('t2', 'Something else entirely?')]))).toEqual(shown)
  })
})
