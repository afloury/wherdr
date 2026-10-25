// Board settings on the server (server/utils/projectsTasks.ts), the launcher
// replaced by recorded output: what runs, in which order, and what comes back.
import os from 'node:os'
import path from 'node:path'
import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { localFs } from '../server/utils/fsx'

const home = path.join(os.tmpdir(), 'wherdr-board-settings')
const machine = { key: '', label: 'devbox', local: true, status: 'online', home, session: 'default', exec: null, sock: () => null, fs: localFs, info: () => ({ key: '' }) }
const remote = { ...machine, key: 'remote', label: 'workstation', local: false, info: () => ({ key: 'remote' }) }
vi.mock('../server/utils/machines', () => ({ allMachines: () => [machine, remote], baseMachines: () => [machine, remote], machineOfPane: () => null }))
vi.mock('../server/utils/actions', () => ({ machineFor: (k: unknown) => (k === 'remote' ? remote : machine) }))
vi.mock('../server/utils/projectsPlugin', () => ({ projectsPluginInfo: async () => ({ status: 'ready', version: '1.2.16', launcher: '/plugins/herdr-projects/bin/run.sh' }) }))
vi.mock('../server/utils/state', () => ({ findPane: () => null, getState: () => ({ panes: [] }) }))
vi.mock('../server/utils/env', () => ({ HERDR_BIN: 'herdr', HERDR_CHILD_ENV: {}, DATA_DIR: path.join(home, 'wherdr-data'), log: () => {} }))
vi.mock('../server/utils/agentAvailability', () => ({ installedAgentKinds: async () => ['claude', 'codex'] }))

const T = await import('../server/utils/projectsTasks')
const recorded = readFileSync(new URL('./recordings/herdr-projects-1.2.16/show-board.json', import.meta.url), 'utf8')

// A board that keeps what `set` and `unset` say, as herdr-projects does.
let calls: { machine: string, args: string[] }[]
let own: Record<string, unknown>
let refuse: string | null
function show(args: string[]) {
  const repo = args.find(a => a.startsWith('--repo='))?.slice(7)
  const base = JSON.parse(recorded)
  return JSON.stringify({ ...base, settings: base.settings.map((r: Record<string, unknown>) => {
    const key = `${repo ?? ''}|${r.name}`
    return key in own ? { ...r, value: own[key], place: repo ? 'repo' : 'you', from: repo ? `your entry for ${repo}` : 'you', own: true } : { ...r, own: repo ? false : r.own }
  }) })
}
beforeEach(() => {
  calls = []
  own = {}
  refuse = null
  T.resetTasksCache()
  T.setRunner(async (m, _launcher, args) => {
    calls.push({ machine: m.key, args })
    const at = args.indexOf('--')
    if (args[0] === 'show') return { code: 0, stdout: show(args), stderr: '' }
    if (refuse) return { code: 1, stdout: '', stderr: refuse }
    const repo = args.find(a => a.startsWith('--repo='))?.slice(7) ?? ''
    if (args[0] === 'set') { own[`${repo}|${args[at + 1]}`] = args[at + 2]; return { code: 0, stdout: `${args[at + 1]}: ${args[at + 2]}  (you)\n`, stderr: '' } }
    if (args[0] === 'unset') { delete own[`${repo}|${args[at + 1]}`]; return { code: 0, stdout: `${args[at + 1]}: back\n`, stderr: '' } }
    return { code: 1, stdout: '', stderr: 'unexpected' }
  })
})

describe('board settings', () => {
  it('reads the user’s settings or one repo’s entry, on the board’s machine, with its agents', async () => {
    const mine = await T.boardSettings('remote', '')
    expect(mine).toMatchObject({ repo: '', agents: ['claude', 'codex'] })
    expect(mine.settings.find(r => r.name === 'board.agents')?.value).toBe(3)
    await T.boardSettings('remote', 'demo')
    expect(calls).toEqual([{ machine: 'remote', args: ['show', '--json'] }, { machine: 'remote', args: ['show', '--json', '--repo=demo'] }])
  })
  it('sets a value, then answers with the settings read again', async () => {
    const r = await T.changeBoardSetting('remote', { name: 'review.rounds', value: '5' })
    expect(calls.map(c => c.args)).toEqual([['set', '--', 'review.rounds', '5'], ['show', '--json']])
    expect(r.settings.find(s => s.name === 'review.rounds')).toMatchObject({ value: '5', place: 'you', own: true })
    expect(r.msg).toBe('review.rounds: 5  (you)')
  })
  it('↺ unsets a repo entry and shows the inherited value again', async () => {
    await T.changeBoardSetting('', { name: 'merge.by', value: 'you', repo: 'demo' })
    expect((await T.boardSettings('', 'demo')).settings.find(s => s.name === 'merge.by')).toMatchObject({ value: 'you', place: 'repo', own: true })
    calls = []
    const r = await T.changeBoardSetting('', { name: 'merge.by', unset: true, repo: 'demo' })
    expect(calls.map(c => c.args)).toEqual([['unset', '--repo=demo', '--', 'merge.by'], ['show', '--json', '--repo=demo']])
    expect(r.settings.find(s => s.name === 'merge.by')).toMatchObject({ value: 'itself', place: 'you', own: false })
  })
  it('passes a refusal on as herdr-projects says it, every line', async () => {
    refuse = 'merge.by must be you, itself, not "itselff".\nDid you mean itself?'
    await expect(T.changeBoardSetting('', { name: 'merge.by', value: 'itselff' })).rejects.toThrow('merge.by must be you, itself, not "itselff".\nDid you mean itself?')
    expect(calls.map(c => c.args[0])).toEqual(['set'])
  })
  it.each([
    { name: 'merge.by', value: '' }, { name: 'merge by', value: 'you' }, { name: 'merge.by', value: 'you', repo: '/etc' }, { name: 'merge.by', value: 'you', repo: 3 },
  ])('refuses %o without running herdr-projects', async (b) => {
    await expect(T.changeBoardSetting('', b)).rejects.toThrow()
    expect(calls).toEqual([])
  })
  it('says when the CLI answers with settings it cannot read', async () => {
    T.setRunner(async () => ({ code: 0, stdout: '{"settings":{}}', stderr: '' }))
    await expect(T.boardSettings('', '')).rejects.toThrow('herdr-projects gave settings wherdr cannot read.')
  })
})
