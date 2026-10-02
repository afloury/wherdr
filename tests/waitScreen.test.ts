// Codex waiting screens at startup (real captures of Codex 0.158 in
// a Herdr test session, throwaway HOME) and synthetic screens.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseChoices } from '../server/utils/choices'
import { parseLegend, parseWaitScreen } from '../server/utils/waitScreen'
import { knownScreen, screenActionLabel, screenNote } from '../app/utils/waitScreen'
import type { Pane } from '../shared/types'

const fx = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')
const screenOf = (text: string) => parseWaitScreen(text, { choices: Boolean(parseChoices(text, { strict: true })) })

describe('parseLegend', () => {
  it('reads the Codex and Claude legends', () => {
    expect(parseLegend('  t trust all · enter review · esc close')).toEqual([
      { key: 't', label: 'trust all' }, { key: 'enter', label: 'review' }, { key: 'esc', label: 'close' },
    ])
    expect(parseLegend(' Enter to confirm · Esc to cancel')).toEqual([{ key: 'enter', label: 'confirm' }, { key: 'esc', label: 'cancel' }])
    expect(parseLegend('  Press enter to continue')).toEqual([{ key: 'enter', label: 'continue' }])
    expect(parseLegend('  ↑/↓ to navigate · enter select')).toEqual([{ key: 'enter', label: 'select' }])
  })

  it('refuses ordinary lines and status bars', () => {
    expect(parseLegend('  ? for shortcuts')).toBeNull()
    expect(parseLegend('  GPT-6-Sol medium · ~/dev/sandbox · Réponds juste pong')).toBeNull()
    expect(parseLegend('a new version is available')).toBeNull()
    expect(parseLegend('  ⏵⏵ accept edits on (shift+tab to cycle)')).toBeNull()
    expect(parseLegend('  ↑/↓ to navigate')).toBeNull()
  })
})

describe('parseWaitScreen', () => {
  it('recognizes Codex\'s Hooks box and its keys', () => {
    const s = screenOf(fx('codex-hooks-box.txt'))!
    expect(parseChoices(fx('codex-hooks-box.txt'), { strict: true })).toBeNull()
    expect(s.kind).toBe('hooks')
    expect(s.title).toBe('Hooks')
    // The › cursor at column 0 keeps the table aligned: 2 spaces before the text.
    expect(s.lines[0]).toBe('  Lifecycle hooks from config and enabled plugins.')
    expect(s.lines).toContain('  ⚠ 4 hooks need review before they can run.')
    expect(s.lines.some(l => l.startsWith('› PreToolUse'))).toBe(true)
    expect(s.lines).not.toContain('↓')
    expect(s.lines.join('\n')).not.toMatch(/OpenAI Codex|white cursor/)
    expect(s.actions).toEqual([{ key: 't', label: 'trust all' }, { key: 'enter', label: 'review' }, { key: 'esc', label: 'close' }])
  })

  it('recognizes "Hooks need review": separate options, extra Escape key', () => {
    const text = fx('codex-hooks-need-review.txt')
    const c = parseChoices(text, { strict: true })!
    expect(c.options.map(o => o.label)).toEqual(['Review hooks', 'Trust all and continue', 'Continue without trusting (hooks won\'t run)'])
    const s = screenOf(text)!
    expect(s.kind).toBe('hooks')
    expect(s.title).toBe('Hooks need review')
    expect(s.lines).toEqual(['4 hooks are new or changed.', 'Hooks can run outside the sandbox after you trust them.'])
    expect(s.actions).toEqual([{ key: 'enter', label: 'confirm' }, { key: 'esc', label: 'skip' }])
  })

  it('recognizes Codex 0.158\'s folder trust', () => {
    const text = fx('codex-trust-folder.txt')
    expect(parseChoices(text, { strict: true })!.options.map(o => o.label)).toEqual(['Trust and continue', 'Back to Agent Command Center'])
    const s = screenOf(text)!
    expect(s.kind).toBe('trust')
    expect(s.title).toBe('Folder access')
    expect(s.lines[0]).toBe('/home/user/code/example')
    expect(s.lines.join(' ')).not.toContain('Trust and continue')
  })

  it('recognizes Codex\'s login (> cursor) and its options', () => {
    const text = fx('codex-login.txt')
    const c = parseChoices(text, { strict: true })!
    expect(c.cursor).toBe(0)
    expect(c.options.map(o => o.label)).toEqual(['Sign in with ChatGPT', 'Sign in with Device Code', 'Provide your own API key'])
    const s = screenOf(text)!
    expect(s.kind).toBe('login')
    expect(s.title).toMatch(/^Welcome to Codex/)
    expect(s.actions).toEqual([{ key: 'enter', label: 'continue' }])
  })

  it('recognizes Claude\'s trust screen', () => {
    expect(screenOf(fx('claude-trust.txt'))!.kind).toBe('trust')
  })

  it('unknown screen with a legend: "other", last lines as preview', () => {
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

  it('nothing when idle (Codex, Claude) nor without a legend', () => {
    expect(parseWaitScreen(fx('codex-idle.txt'))).toBeNull()
    expect(parseWaitScreen(fx('claude-idle.txt'))).toBeNull()
    expect(parseWaitScreen(fx('claude-done.txt'))).toBeNull()
    expect(parseWaitScreen('')).toBeNull()
    expect(parseWaitScreen('Hooks\n4 hooks need review\n› PreToolUse')).toBeNull()
  })
})

describe('app labels', () => {
  it('translates the known keys and actions', () => {
    expect(screenActionLabel({ key: 't', label: 'trust all' }, false)).toBe('Tout approuver (t)')
    expect(screenActionLabel({ key: 'enter', label: 'review' }, false)).toBe('Revoir (Entrée)')
    expect(screenActionLabel({ key: 'esc', label: 'close' }, false)).toBe('Fermer (Échap)')
    expect(screenActionLabel({ key: 'esc', label: 'close' }, true)).toBe('Close (Esc)')
    expect(screenActionLabel({ key: 'x', label: 'toggle plugins' }, false)).toBe('Toggle plugins (x)')
    // /resume toggles, in both directions.
    expect(screenActionLabel({ key: 'ctrl+a', label: 'only show current repo' }, false)).toBe('Projet courant seulement (Ctrl+A)')
    expect(screenActionLabel({ key: 'ctrl+b', label: 'show all branches' }, true)).toBe('All branches (Ctrl+B)')
  })

  it('knownScreen: only a recognized screen, when not working', () => {
    const screen = { kind: 'hooks' as const, title: 'Hooks', lines: [], actions: [] }
    const pane = { id: 'w1:p1', status: 'idle', screen } as unknown as Pane
    expect(knownScreen(pane)).toBe(screen)
    expect(knownScreen({ ...pane, status: 'working' })).toBeNull()
    expect(knownScreen({ ...pane, screen: { ...screen, kind: 'other' } })).toBeNull()
    expect(screenNote('hooks', false)).toMatch(/hooks/)
    expect(screenNote('other', false)).toBeNull()
  })
})
