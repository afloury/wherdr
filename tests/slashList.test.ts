import { describe, expect, it } from 'vitest'
import { firstSlash, matchSlash, slashKey, slashToken, type SlashKeyState } from '../app/utils/slashList'
import type { SlashCommand } from '../shared/slashCommands'

const cmd = (name: string, desc?: string, extra: Partial<SlashCommand> = {}): SlashCommand => ({ name, desc, kind: name.startsWith('skill:') ? 'skill' : 'command', ...extra })
const COMMANDS: SlashCommand[] = [
  cmd('compact', 'Summarize the conversation'),
  cmd('context', 'Show context usage'),
  cmd('model', 'Change model', { aliases: ['models'] }),
  cmd('deploy', 'Ship it after a retro of the build'),
  cmd('skill:retro', 'Run a retrospective on a coding session'),
  cmd('skill:release-notes', 'Draft release notes'),
  cmd('skill:pdf-fill', 'Fill in PDF forms'),
  cmd('acme:review-api', 'Review an API change'),
]
const names = (token: string) => matchSlash(COMMANDS, token).map(m => m.cmd.name)

describe('slashToken', () => {
  it('is the word after a lone "/"', () => {
    expect(slashToken('/')).toBe('')
    expect(slashToken('/ret')).toBe('ret')
    expect(slashToken('/skill:retro')).toBe('skill:retro')
  })

  it('is null once the message goes on, or is not a command', () => {
    for (const text of ['', 'hi', ' /ret', '/ret now', '/ret ', '/srv/app/x', '/a\nb']) expect(slashToken(text)).toBeNull()
  })
})

describe('matchSlash', () => {
  it('lists everything, alphabetical, for a bare "/"', () => {
    expect(names('')).toEqual(COMMANDS.map(c => c.name).sort())
  })

  it('finds a skill by a word of its name or its description: "retro" for "skill:retro"', () => {
    expect(names('retro')).toEqual(['skill:retro', 'deploy'])
  })

  it('ranks the name before the description: exact, prefix, word start, inside, description', () => {
    const list = [cmd('zz-pdf', 'x'), cmd('pdf', 'x'), cmd('mypdf', 'x'), cmd('export', 'make a pdf file'), cmd('a-pdf', 'x'), cmd('pdftool', 'x')]
    expect(matchSlash(list, 'pdf').map(m => [m.cmd.name, m.tier])).toEqual([['pdf', 0], ['pdftool', 1], ['a-pdf', 2], ['zz-pdf', 2], ['mypdf', 3], ['export', 4]])
  })

  it('counts aliases as names', () => {
    expect(matchSlash(COMMANDS, 'models').map(m => [m.cmd.name, m.tier, m.exact])).toEqual([['model', 0, true]])
  })

  it('keeps a single letter to the start of a name or of a word of it', () => {
    expect(names('r')).toEqual(['acme:review-api', 'skill:release-notes', 'skill:retro'])
  })

  it('matches without regard to case, and tells when the word is typed as written', () => {
    expect(matchSlash(COMMANDS, 'Compact').map(m => [m.cmd.name, m.exact])).toEqual([['compact', false]])
    expect(matchSlash(COMMANDS, 'compact').map(m => [m.cmd.name, m.exact])).toEqual([['compact', true]])
  })

  it('finds nothing for an unknown word', () => {
    expect(names('zzz')).toEqual([])
  })
})

describe('firstSlash', () => {
  it('starts on the best name match, nowhere for a bare "/" or a description-only answer', () => {
    expect(firstSlash(matchSlash(COMMANDS, 'ret'), 'ret')).toBe(0)
    expect(firstSlash(matchSlash(COMMANDS, ''), '')).toBe(-1)
    expect(firstSlash(matchSlash([cmd('export', 'make a pdf file')], 'pdf'), 'pdf')).toBe(-1)
    expect(firstSlash([], 'zzz')).toBe(-1)
  })
})

describe('slashKey', () => {
  const key = (k: string, mods: { shiftKey?: boolean, ctrlKey?: boolean, altKey?: boolean, metaKey?: boolean, isComposing?: boolean } = {}) =>
    ({ key: k, shiftKey: false, ctrlKey: false, altKey: false, metaKey: false, ...mods })
  const state = (over: Partial<SlashKeyState> = {}): SlashKeyState => ({ count: 3, active: 0, current: undefined, moved: false, ...over })
  const partial = matchSlash(COMMANDS, 'comp')[0]
  const typed = matchSlash(COMMANDS, 'compact')[0]

  it('moves the highlight with the arrows, round the list', () => {
    expect(slashKey(key('ArrowDown'), state({ active: 2 }))).toEqual({ type: 'move', to: 0 })
    expect(slashKey(key('ArrowDown'), state({ active: -1 }))).toEqual({ type: 'move', to: 0 })
    expect(slashKey(key('ArrowUp'), state({ active: 0 }))).toEqual({ type: 'move', to: 2 })
    expect(slashKey(key('ArrowUp'), state({ active: -1 }))).toEqual({ type: 'move', to: 2 })
    expect(slashKey(key('ArrowUp'), state({ active: 2 }))).toEqual({ type: 'move', to: 1 })
  })

  it('goes into the list with Tab, then completes the highlighted row', () => {
    expect(slashKey(key('Tab'), state({ active: -1 }))).toEqual({ type: 'move', to: 0 })
    expect(slashKey(key('Tab'), state({ active: 1 }))).toEqual({ type: 'pick', index: 1 })
  })

  it('completes with Enter, unless nothing is highlighted or the command is typed in full', () => {
    expect(slashKey(key('Enter'), state({ active: 1, current: partial }))).toEqual({ type: 'pick', index: 1 })
    expect(slashKey(key('Enter'), state({ active: -1 }))).toBeNull()
    expect(slashKey(key('Enter'), state({ active: 0, current: typed }))).toBeNull()
    expect(slashKey(key('Enter'), state({ active: 0, current: typed, moved: true }))).toEqual({ type: 'pick', index: 0 })
  })

  it('closes with Escape, also while there is no row yet', () => {
    expect(slashKey(key('Escape'), state())).toEqual({ type: 'close' })
    expect(slashKey(key('Escape'), state({ count: 0, active: -1 }))).toEqual({ type: 'close' })
  })

  it('leaves everything else to the field', () => {
    expect(slashKey(key('ArrowDown'), state({ count: 0, active: -1 }))).toBeNull()
    expect(slashKey(key('Enter'), state({ count: 0, active: -1 }))).toBeNull()
    expect(slashKey(key('a'), state())).toBeNull()
    expect(slashKey(key('ArrowDown', { ctrlKey: true }), state())).toBeNull()
    expect(slashKey(key('Tab', { shiftKey: true }), state())).toBeNull()
    expect(slashKey(key('Enter', { shiftKey: true }), state({ current: partial }))).toBeNull()
    expect(slashKey(key('Enter', { isComposing: true }), state({ current: partial }))).toBeNull()
    expect(slashKey(key('Escape', { metaKey: true }), state())).toBeNull()
  })
})
