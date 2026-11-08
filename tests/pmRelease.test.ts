import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createPmStore } from '../server/utils/pmStore'
import { startTask, type PmLaunchDeps } from '../server/utils/pmLaunch'
import { releaseIdle } from '../server/utils/pmRelease'
import { advanceTick } from '../server/utils/pmAdvance'
import { RELEASE_IDLE_MS, agentsAtWork, idleSince, releaseDue } from '../shared/pm/release'
import { initialState } from '../shared/pm/steps'
import { wherdr } from '../shared/pm/examples'
import type { Run, Task } from '../shared/pm/run'

const task = (over: Partial<Task> = {}): Task => ({
  id: 'WH-1', project: 'WH', title: 'Fix it', description: '', type: 'simple', state: 'working', createdAt: 0,
  step: { ...initialState(), started: true, at: 1, since: 5, told: 5 }, ...over,
})
const yourTurn = (t = task()) => ({ ...t, step: { ...t.step!, at: 4, yourTurn: { reason: 'action' as const, badge: 'Merge: guarded' } } })

describe('the release rules', () => {
  it('counts idle time only while the task waits for the user and no agent works', () => {
    expect(idleSince(undefined, task(), false, 10)).toBeUndefined() // under way
    expect(idleSince(undefined, yourTurn(), false, 10)).toBe(10)
    expect(idleSince(10, yourTurn(), false, 99)).toBe(10)
    expect(idleSince(10, yourTurn(), true, 99)).toBeUndefined() // its agent works again
    // An agent's question keeps its agent; a failure waits for the user.
    expect(idleSince(undefined, task({ state: 'waiting', waitKind: 'question' }), false, 10)).toBeUndefined()
    expect(idleSince(undefined, task({ state: 'waiting', waiting: 'claude stopped' }), false, 10)).toBe(10)
    const late = task({ step: { ...task().step!, yourTurn: { reason: 'timeout', badge: 'Check work: over 2h' } } })
    expect(idleSince(undefined, late, false, 10)).toBeUndefined() // its agent is to be looked at
    expect(releaseDue(10, 10 + RELEASE_IDLE_MS - 1)).toBe(false)
    expect(releaseDue(10, 10 + RELEASE_IDLE_MS)).toBe(true)
  })

  it('the machine cap counts only agents holding a step under way', () => {
    const run = (id: string, t: string, role: Run['role'] = 'worker'): Run => ({ id, task: t, role, program: 'claude', model: 'm', machine: 'm1', worktree: '/w', branch: 'b', instructions: '/i', attempt: 1, state: 'running', startedAt: 1 })
    const tasks = [task(), yourTurn(task({ id: 'WH-2' })), task({ id: 'WH-3', step: { ...task().step!, at: 3 } })]
    const holder = (t: Task) => (t.step!.at === 3 ? 'reviewer' : 'worker')
    // WH-1's worker works; WH-2 waits for the user; WH-3 is in review: its idle worker does not count.
    const runs = [run('a', 'WH-1'), run('b', 'WH-2'), run('c', 'WH-2', 'reviewer'), run('d', 'WH-3'), run('e', 'WH-3', 'reviewer'), { ...run('f', 'WH-1'), machine: 'm2' }]
    expect(agentsAtWork(runs, tasks, 'm1', holder)).toHaveLength(2)
  })
})

describe('release and restart on the server', () => {
  let dir = ''
  beforeEach(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pm-release-')) })
  afterEach(() => fs.rm(dir, { recursive: true, force: true }))

  it('ends the idle agents of a task waiting for the user, then starts the worker again on a send-back', async () => {
    const store = createPmStore(dir)
    await store.setEnabled(true)
    await store.saveTemplate(wherdr)
    await store.addProject({ key: 'WH', machine: 'm1', path: '/home/u/wh', template: 'wherdr' }, async (_m, p) => p)
    await store.addTask({ project: 'WH', title: 'Fix it', type: 'simple' })
    const calls: [string, Record<string, unknown>][] = [], files: Record<string, string> = {}
    const call = async (method: string, p: Record<string, unknown>) => {
      calls.push([method, p])
      if (method === 'machine.exec') {
        const [, , script, , ...args] = p.argv as string[]
        if (script!.includes('command -v')) return { code: 0, stdout: Buffer.from('claude').toString('base64') }
        if (script!.includes('$HOME')) return { code: 0, stdout: Buffer.from('/home/u').toString('base64') }
        if (p.input) files[args[0]!] = Buffer.from(p.input as string, 'base64').toString()
        return { code: 0, stdout: '' }
      }
      if (method === 'terminal.run') return { address: `m1/t${calls.filter(c => c[0] === 'terminal.run').length}` }
      if (method === 'terminal.list') return { terminals: [{ address: 'm1/t1', labels: {}, state: 'running', status: { state: 'idle' } }] }
      if (['terminal.get', 'terminal.kill', 'terminal.label', 'terminal.send'].includes(method)) return { state: 'running' }
      throw new Error(`unexpected ${method}`)
    }
    const deps = { call, store, machines: () => [{ key: 'm1', label: 'm1', local: false, status: 'online' }], launchWatchMs: 0 } as unknown as PmLaunchDeps
    await startTask(deps, 'WH-1')
    await store.saveTask(yourTurn((await store.task('WH-1'))!))

    expect(await releaseIdle(deps, 0)).toEqual([])
    expect(await releaseIdle(deps, RELEASE_IDLE_MS)).toEqual(['WH-1'])
    expect(calls.filter(c => c[0] === 'terminal.kill')).toEqual([['terminal.kill', { terminal: 'm1/t1' }]])
    expect((await store.runs())[0]).toMatchObject({ state: 'ended', endedBy: 'released' })
    const t = (await store.task('WH-1'))!
    expect(t).toMatchObject({ state: 'working', step: { yourTurn: { badge: 'Merge: guarded' } } }) // the board shows it as before
    expect(t.log!.slice(-2).map(e => e.text)).toEqual([
      'released its agents: idle for 10 minutes while the task waits for you; they start again when it needs them',
      'ended the worker (claude claude-opus-5-5) to free memory; its worktree stays',
    ])

    // Sent back to the worker: a new one in the same worktree, with the handover and what to fix.
    const finding = { id: 'no-test', severity: 'major' as const, title: 'No test', proof: '0 tests' }
    await store.saveTask({ ...t, step: { ...t.step!, at: 1, since: 50, told: undefined, yourTurn: undefined, backFrom: 'review', reviews: { review: [{ findings: [finding] }] } } })
    await advanceTick(deps)
    const runs = calls.filter(c => c[0] === 'terminal.run')
    expect(runs).toHaveLength(2)
    expect(runs[1]![1]).toMatchObject({ cwd: '/home/u/.wherdr/pm/worktrees/WH-1' })
    expect(files['/home/u/.wherdr/pm/tasks/WH-1/instructions.md']).toMatch(/## Handover[\s\S]*idle for 10 minutes[\s\S]*No test/)
    const back = (await store.task('WH-1'))!
    expect(back.step).toMatchObject({ at: 1, told: 50 }) // the handover gave it: not sent again
    expect(back.log!.at(-1)!.text).toBe('started the worker again in its worktree: work needs it')
    expect(calls.some(c => c[0] === 'terminal.send')).toBe(false)
  })
})
