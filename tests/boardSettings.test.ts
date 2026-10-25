import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  boardSettingTheme, canReset, differsForRepo, parseBoardSettings, settingArgs, settingChoice, settingText, settingWarning, tabRows, themedRows,
} from '../shared/boardSettings'
import { boardSettingsMachines } from '../app/utils/boardScope'
import { boardSettingLabel, boardSettingThemeLabel, settingWarningText } from '../app/utils/boardSettings'

// `show --json` of a fresh board with three settings of the user's own.
const recorded = readFileSync(new URL('./recordings/herdr-projects-1.2.16/show-board.json', import.meta.url), 'utf8')

describe('board settings from show', () => {
  const { settings, problems } = parseBoardSettings(recorded)
  it('reads every row with its typed value and provenance', () => {
    expect(problems).toEqual([])
    expect(settings.find(r => r.name === 'board.agents')).toMatchObject({ kind: 'board', value: 3, place: 'you', own: true })
    expect(settings.find(r => r.name === 'worker.fallback')?.value).toEqual(['codex', 'claude'])
    expect(settings.find(r => r.name === 'reviewer.fast')).toMatchObject({ value: false, place: 'builtin', own: false })
  })
  it('splits the Machine and Defaults tabs by kind, without losing a row', () => {
    const machine = tabRows(settings, 'machine')
    const defaults = tabRows(settings, 'defaults')
    expect(machine.map(r => r.name)).toEqual(expect.arrayContaining(['board.agents', 'board.notify', 'board.theme', 'watcher.agent', 'coordinator.agent', 'autopilot.every']))
    expect(machine.some(r => r.name.startsWith('worker.'))).toBe(false)
    expect(defaults.map(r => r.name)).toEqual(expect.arrayContaining(['worker.agent', 'review.when', 'merge.by', 'limit.time', 'research.only']))
    expect(defaults.some(r => r.kind === 'board' || r.kind === 'coordinator')).toBe(false)
    expect(machine.length + defaults.length).toBe(settings.length)
  })
  it('groups the work settings by theme, in the order of the screen', () => {
    expect(themedRows(settings, 'defaults').map(g => g.theme)).toEqual(['worker', 'review', 'plan', 'attempts', 'merge', 'limits', 'workspace', 'check', 'modes'])
    expect(themedRows(settings, 'machine').map(g => g.theme)).toEqual(['board', 'coordinator', 'autopilot', 'watcher', 'voice'])
    expect(['reviewer.agent', 'review.evidence', 'chat.only', 'check.again', 'future.thing'].map(boardSettingTheme)).toEqual(['review', 'review', 'modes', 'check', 'other'])
    expect(boardSettingThemeLabel('worker')).toBe('Who works')
  })
  it('keeps a repo entry’s own rows apart from inherited ones', () => {
    const repo = parseBoardSettings(JSON.stringify({ settings: [
      { name: 'worker.agent', kind: 'work', value: 'codex', place: 'you', from: 'you', own: false },
      { name: 'merge.by', kind: 'work', value: 'you', place: 'repo', from: 'your entry for demo', own: true },
      { name: 'check.command', kind: 'work', value: 'npm test', place: 'file', from: "the repo's file", own: false },
      { name: 'repo.key', kind: 'repo', value: 'DEMO', place: 'repo', from: 'your entry for demo', own: true },
    ] })).settings
    expect(tabRows(repo, 'repo').map(r => r.name)).toEqual(['worker.agent', 'merge.by', 'check.command', 'repo.key'])
    expect(repo.filter(differsForRepo).map(r => r.name)).toEqual(['merge.by', 'check.command', 'repo.key'])
    // Only what is said at this level goes back with ↺: not the repo's file.
    expect(repo.filter(canReset).map(r => r.name)).toEqual(['merge.by', 'repo.key'])
  })
})

describe('choices', () => {
  it('offers the lists herdr-projects documents, and text elsewhere', () => {
    expect(settingChoice('merge.by', 'you')).toEqual({ type: 'pick', values: ['you', 'itself'] })
    expect(settingChoice('review.mustFix', 'major')).toMatchObject({ values: ['critical', 'major', 'minor', 'trivial'] })
    expect(settingChoice('worker.access', 'full')).toEqual({ type: 'pick', values: ['full', 'ask'] })
    expect(settingChoice('worker.fast', false)).toEqual({ type: 'switch' })
    expect(settingChoice('worker.agent', 'codex')).toEqual({ type: 'agent', none: false })
    expect(settingChoice('plan.agent', 'none')).toEqual({ type: 'agent', none: true })
    expect(settingChoice('reviewer.effort', 'default')).toEqual({ type: 'effort', agent: 'reviewer.agent' })
    expect(settingChoice('worker.instructions', 'none')).toEqual({ type: 'text', long: true })
    expect(settingChoice('merge.method', 'squash')).toEqual({ type: 'text', long: false })
  })
  it('writes a value back as set takes it', () => {
    expect([['codex', 'claude/opus'], true, 3, null, 'none'].map(settingText)).toEqual(['codex, claude/opus', 'true', '3', '', 'none'])
  })
})

describe('set and unset', () => {
  it('builds the commands, for the user or a repo entry', () => {
    expect(settingArgs({ name: 'merge.by', value: ' itself ' })).toEqual(['set', '--', 'merge.by', 'itself'])
    expect(settingArgs({ name: 'worker.instructions', value: '-run the tests', repo: 'demo' })).toEqual(['set', '--repo=demo', '--', 'worker.instructions', '-run the tests'])
    expect(settingArgs({ name: 'merge.by', unset: true, repo: 'demo' })).toEqual(['unset', '--repo=demo', '--', 'merge.by'])
    expect(settingArgs({ name: 'board.agents', unset: true, repo: '' })).toEqual(['unset', '--', 'board.agents'])
  })
  it.each([
    { name: '--repo', value: 'x' }, { name: 'merge.by' }, { name: 'merge.by', value: '  ' }, { name: 'merge.by', value: 'a\u0000b' },
    { name: 'merge.by', value: 'x'.repeat(8001) }, { name: 'merge.by', value: 'you', repo: '../etc' }, { name: 'merge.by', unset: 'yes' }, { name: 3, value: 'x' },
  ])('refuses %o before running anything', c => {
    expect(() => settingArgs(c)).toThrow()
  })
})

describe('confirmations', () => {
  it('asks before what acts at once on the whole board', () => {
    expect(settingWarning('merge.by', 'itself')).toBe('mergeItself')
    expect(settingWarning('merge.by', 'you')).toBeNull()
    expect(settingWarning('merge.by', null)).toBe('mayMergeItself')
    expect(settingWarning('merge.checks', 'none')).toBe('mergeNoChecks')
    expect(settingWarning('review.when', 'never')).toBe('noReview')
    expect(settingWarning('board.agents', '8')).toBe('boardAgents')
    expect(settingWarning('worker.agent', 'codex')).toBeNull()
    expect(settingWarningText('mergeItself', '')).toContain('Tasks already reviewed will merge right away')
    expect(settingWarningText('mergeItself', 'demo')).toContain('in demo')
  })
})

describe('machine choice', () => {
  const groups = [{ id: '*group:a', name: 'Lab', machines: ['vm-b', 'vm-a', 'gone'] }]
  it('opens one machine at once and asks among a group’s or every machine', () => {
    expect(boardSettingsMachines('vm-a', ['', 'vm-a', 'vm-b'], groups)).toEqual(['vm-a'])
    expect(boardSettingsMachines('', ['', 'vm-a'], groups)).toEqual([''])
    expect(boardSettingsMachines('*', ['', 'vm-a', 'vm-b'], groups)).toEqual(['', 'vm-a', 'vm-b'])
    // The Board's order, and only machines with a board.
    expect(boardSettingsMachines('*group:a', ['', 'vm-a', 'vm-b'], groups)).toEqual(['vm-a', 'vm-b'])
    expect(boardSettingsMachines('*group:none', ['', 'vm-a'], groups)).toEqual(['', 'vm-a'])
  })
  it('labels board settings in both languages', () => {
    expect(boardSettingLabel('board.agents')).toBe('Agents at once')
    expect(boardSettingLabel('merge.by')).toBe('Who merges')
    expect(boardSettingLabel('future.thing')).toBe('future.thing')
  })
})
