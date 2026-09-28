// Écrans d'attente de Codex au démarrage (captures réelles de Codex 0.158 dans
// une session Herdr de test, HOME jetable) et écrans synthétiques.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseChoices } from '../server/utils/choices'
import { parseLegend, parseWaitScreen } from '../server/utils/waitScreen'
import { knownScreen, screenActionLabel, screenNote } from '../app/utils/waitScreen'
import type { Pane } from '../shared/types'

const fx = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')
const screenOf = (text: string) => parseWaitScreen(text, { choices: Boolean(parseChoices(text, { strict: true })) })

describe('parseLegend', () => {
  it('lit les légendes de Codex et de Claude', () => {
    expect(parseLegend('  t trust all · enter review · esc close')).toEqual([
      { key: 't', label: 'trust all' }, { key: 'enter', label: 'review' }, { key: 'esc', label: 'close' },
    ])
    expect(parseLegend(' Enter to confirm · Esc to cancel')).toEqual([{ key: 'enter', label: 'confirm' }, { key: 'esc', label: 'cancel' }])
    expect(parseLegend('  Press enter to continue')).toEqual([{ key: 'enter', label: 'continue' }])
    expect(parseLegend('  ↑/↓ to navigate · enter select')).toEqual([{ key: 'enter', label: 'select' }])
  })

  it('refuse les lignes ordinaires et les barres d’état', () => {
    expect(parseLegend('  ? for shortcuts')).toBeNull()
    expect(parseLegend('  GPT-6-Sol medium · ~/dev/sandbox · Réponds juste pong')).toBeNull()
    expect(parseLegend('a new version is available')).toBeNull()
    expect(parseLegend('  ⏵⏵ accept edits on (shift+tab to cycle)')).toBeNull()
    expect(parseLegend('  ↑/↓ to navigate')).toBeNull()
  })
})

describe('parseWaitScreen', () => {
  it('reconnaît la boîte Hooks de Codex et ses touches', () => {
    const s = screenOf(fx('codex-hooks-box.txt'))!
    expect(parseChoices(fx('codex-hooks-box.txt'), { strict: true })).toBeNull()
    expect(s.kind).toBe('hooks')
    expect(s.title).toBe('Hooks')
    // Le curseur › en colonne 0 garde l'alignement du tableau : 2 espaces devant le texte.
    expect(s.lines[0]).toBe('  Lifecycle hooks from config and enabled plugins.')
    expect(s.lines).toContain('  ⚠ 4 hooks need review before they can run.')
    expect(s.lines.some(l => l.startsWith('› PreToolUse'))).toBe(true)
    expect(s.lines).not.toContain('↓')
    expect(s.lines.join('\n')).not.toMatch(/OpenAI Codex|white cursor/)
    expect(s.actions).toEqual([{ key: 't', label: 'trust all' }, { key: 'enter', label: 'review' }, { key: 'esc', label: 'close' }])
  })

  it('reconnaît « Hooks need review » : options à part, touche Échap en plus', () => {
    const text = fx('codex-hooks-need-review.txt')
    const c = parseChoices(text, { strict: true })!
    expect(c.options.map(o => o.label)).toEqual(['Review hooks', 'Trust all and continue', 'Continue without trusting (hooks won\'t run)'])
    const s = screenOf(text)!
    expect(s.kind).toBe('hooks')
    expect(s.title).toBe('Hooks need review')
    expect(s.lines).toEqual(['4 hooks are new or changed.', 'Hooks can run outside the sandbox after you trust them.'])
    expect(s.actions).toEqual([{ key: 'enter', label: 'confirm' }, { key: 'esc', label: 'skip' }])
  })

  it('reconnaît la confiance du dossier de Codex 0.158', () => {
    const text = fx('codex-trust-folder.txt')
    expect(parseChoices(text, { strict: true })!.options.map(o => o.label)).toEqual(['Trust and continue', 'Back to Agent Command Center'])
    const s = screenOf(text)!
    expect(s.kind).toBe('trust')
    expect(s.title).toBe('Folder access')
    expect(s.lines[0]).toBe('/home/user/code/example')
    expect(s.lines.join(' ')).not.toContain('Trust and continue')
  })

  it('reconnaît la connexion de Codex (curseur >) et ses options', () => {
    const text = fx('codex-login.txt')
    const c = parseChoices(text, { strict: true })!
    expect(c.cursor).toBe(0)
    expect(c.options.map(o => o.label)).toEqual(['Sign in with ChatGPT', 'Sign in with Device Code', 'Provide your own API key'])
    const s = screenOf(text)!
    expect(s.kind).toBe('login')
    expect(s.title).toMatch(/^Welcome to Codex/)
    expect(s.actions).toEqual([{ key: 'enter', label: 'continue' }])
  })

  it('reconnaît l’écran de confiance de Claude', () => {
    expect(screenOf(fx('claude-trust.txt'))!.kind).toBe('trust')
  })

  it('écran inconnu avec une légende : « other », dernières lignes en aperçu', () => {
    const s = parseWaitScreen([
      '  >_ OpenAI Codex (v9.9.9)',
      '',
      '  Choose a theme',
      '  Dark themes look better at night.',
      '  ▸ Midnight   Daylight   Solar',
      '',
      '  ←/→ to move · enter apply · esc cancel',
    ].join('\n'))!
    expect(s.kind).toBe('other')
    expect(s.title).toBeNull()
    expect(s.lines).toEqual(['Choose a theme', 'Dark themes look better at night.', '▸ Midnight   Daylight   Solar'])
    expect(s.actions.map(a => a.key)).toEqual(['enter', 'esc'])
  })

  it('rien au repos (Codex, Claude) ni sans légende', () => {
    expect(parseWaitScreen(fx('codex-idle.txt'))).toBeNull()
    expect(parseWaitScreen(fx('claude-idle.txt'))).toBeNull()
    expect(parseWaitScreen(fx('claude-done.txt'))).toBeNull()
    expect(parseWaitScreen('')).toBeNull()
    expect(parseWaitScreen('Hooks\n4 hooks need review\n› PreToolUse')).toBeNull()
  })
})

describe('libellés de l’app', () => {
  it('traduit les touches et les actions connues', () => {
    expect(screenActionLabel({ key: 't', label: 'trust all' }, false)).toBe('Tout approuver (t)')
    expect(screenActionLabel({ key: 'enter', label: 'review' }, false)).toBe('Revoir (Entrée)')
    expect(screenActionLabel({ key: 'esc', label: 'close' }, false)).toBe('Fermer (Échap)')
    expect(screenActionLabel({ key: 'esc', label: 'close' }, true)).toBe('Close (Esc)')
    expect(screenActionLabel({ key: 'x', label: 'toggle plugins' }, false)).toBe('Toggle plugins (x)')
  })

  it('knownScreen : seulement un écran reconnu, hors travail', () => {
    const screen = { kind: 'hooks' as const, title: 'Hooks', lines: [], actions: [] }
    const pane = { id: 'w1:p1', status: 'idle', screen } as unknown as Pane
    expect(knownScreen(pane)).toBe(screen)
    expect(knownScreen({ ...pane, status: 'working' })).toBeNull()
    expect(knownScreen({ ...pane, screen: { ...screen, kind: 'other' } })).toBeNull()
    expect(screenNote('hooks', false)).toMatch(/hooks/)
    expect(screenNote('other', false)).toBeNull()
  })
})
