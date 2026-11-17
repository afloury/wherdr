import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPmStore } from '../server/utils/pmStore'
import { startTask, type PmLaunchDeps } from '../server/utils/pmLaunch'
import { advanceTick } from '../server/utils/pmAdvance'
import { resumeParked } from '../server/utils/pmPark'
import { parkOf, parseBlockedOn, resumeText } from '../shared/pm/park'
import { stallOf } from '../shared/pm/blocked'
import { agentNeeded } from '../shared/pm/watchdog'
import { initialState } from '../shared/pm/steps'
import { wherdr } from '../shared/pm/examples'
import { taskPlan, type Task } from '../shared/pm/run'

const woken = vi.hoisted(() => [] as string[])
vi.mock('../server/utils/pmWakes', async orig => ({ ...(await orig<object>()), wakeCoordinators: async (_d: unknown, _t: unknown, why: string) => { woken.push(why); return ['the project\'s coordinator'] } }))

const projects = [{ key: 'WH', machine: 'm1', path: '/p', template: 'wherdr' }] as never
const task = (over: Partial<Task> = {}): Task => ({ id: 'WH-1', project: 'WH', title: 'Client', description: '', type: 'simple', state: 'working', createdAt: 0, ...over })

describe('a blocked report', () => {
  it('names a task: an after link and parked; a repository: parked for a new task; a cycle: refused, a decision', () => {
    expect(parseBlockedOn('blocked:on WH-2: the /api/items endpoint')).toEqual({ on: 'WH-2', need: 'the /api/items endpoint' })
    expect(parseBlockedOn('blocked:on WH-2')).toBeUndefined()
    const other = task({ id: 'WH-2', title: 'API', state: 'todo' })
    const r = parkOf(task({ after: 'WH-0' }), 'wh-2', 'the endpoint', [task(), other, task({ id: 'WH-0' })], projects, 9)
    expect(r).toMatchObject({ park: { after: 'WH-0,WH-2', parked: { on: 'WH-2', need: 'the endpoint', at: 9, before: ['WH-0'] } } })
    expect('wake' in r && r.wake).toContain('goes on in the same conversation once WH-2 is done')
    const repo = parkOf(task(), 'billing-api', 'a refund call', [task()], projects, 9)
    expect(repo).toMatchObject({ park: { parked: { on: 'billing-api', before: [] } } })
    expect('park' in repo && repo.wake).toContain('Add a task there')
    const cycle = parkOf(task(), 'WH-2', 'the schema', [task(), { ...other, after: 'WH-1' }], projects, 9)
    expect(cycle).toMatchObject({ refused: expect.stringContaining('already waits for this task'), key: 'cycle:WH-2' })
    expect('refused' in cycle && cycle.wake).toMatch(/Decision: .*pull the shared contract .* or merge the two tasks into one\..*Decisions/)
  })

  it('a parked task never stalls nor needs an agent, and resumes once what it waits for is done', () => {
    const plan = taskPlan(wherdr, task())
    const t = task({ idle: 0, after: 'WH-2', parked: { on: 'WH-2', need: 'the endpoint', at: 0, before: [] }, step: { ...initialState(), started: true, at: 1, since: 0, told: 0 } })
    expect(stallOf({ ...t, parked: undefined }, plan, 3_600_000)).toBeDefined()
    expect(stallOf(t, plan, 3_600_000)).toBeUndefined()
    expect(agentNeeded(t, plan)).toBeUndefined()
    const other = task({ id: 'WH-2', title: 'API', step: { ...initialState(), started: true, at: 1 } })
    expect(resumeText(t, [t, other], projects)).toBeUndefined()
    const done = { ...other, links: [{ label: 'PR', url: 'https://github.com/o/r/pull/7' }], workReports: [{ step: 'work', text: 'Added GET /api/items.' }], step: { ...other.step!, done: true } }
    expect(resumeText(t, [t, done], projects)).toBe('You were waiting for WH-2: the endpoint\n- WH-2 (API) is done, PR https://github.com/o/r/pull/7. Its report: Added GET /api/items.\nUpdate your branch with what you need, then go on with your task.')
  })
})

describe('parking on the server', () => {
  let dir = ''
  beforeEach(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pm-park-')); woken.length = 0 })
  afterEach(() => fs.rm(dir, { recursive: true, force: true }))

  async function setup(second: Partial<Task> = {}) {
    const store = createPmStore(dir)
    await store.setEnabled(true)
    await store.saveTemplate(wherdr)
    await store.addProject({ key: 'WH', machine: 'm1', path: '/home/u/wh', template: 'wherdr' }, async (_m, p) => p)
    await store.addTask({ project: 'WH', title: 'Client', type: 'simple' })
    await store.saveTask({ ...(await store.addTask({ project: 'WH', title: 'API', type: 'simple' })), ...second })
    const calls: [string, Record<string, unknown>][] = []
    const env = { label: '' }
    const call = async (method: string, p: Record<string, unknown>) => {
      calls.push([method, p])
      if (method === 'machine.exec') {
        const [, , script] = p.argv as string[]
        if (script!.includes('command -v')) return { code: 0, stdout: Buffer.from('claude').toString('base64') }
        if (script!.includes('$HOME')) return { code: 0, stdout: Buffer.from('/home/u').toString('base64') }
        return { code: 0, stdout: '' }
      }
      if (method === 'terminal.run') return { address: `m1/t${calls.filter(c => c[0] === 'terminal.run').length}` }
      if (method === 'terminal.list') return { terminals: [{ address: 'm1/t1', labels: { 'wherdr.report': env.label }, state: 'running', status: { state: 'idle' } }] }
      if (['terminal.get', 'terminal.kill', 'terminal.label', 'terminal.send'].includes(method)) return { state: 'running' }
      throw new Error(`unexpected ${method}`)
    }
    const deps = { call, store, machines: () => [{ key: 'm1', label: 'm1', local: false, status: 'online' }], launchWatchMs: 0 } as unknown as PmLaunchDeps
    await startTask(deps, 'WH-1')
    return { store, calls, env, deps }
  }

  it('parks on a task with one wake, frees its agent, then resumes the same conversation once that task is done', async () => {
    const { store, calls, env, deps } = await setup()
    env.label = 'blocked:on WH-2: the /api/items endpoint'
    await advanceTick(deps, 1000)
    await advanceTick(deps, 2000) // the label seen again: nothing more
    const t = (await store.task('WH-1'))!
    expect(t).toMatchObject({ state: 'working', after: 'WH-2', parked: { on: 'WH-2', need: 'the /api/items endpoint' } })
    expect(woken).toHaveLength(1)
    const run = (await store.runs())[0]!
    expect(run).toMatchObject({ state: 'ended', endedBy: 'released' })
    expect(calls.filter(c => c[0] === 'terminal.kill')).toHaveLength(1)

    await resumeParked(deps) // WH-2 not done yet
    expect(calls.filter(c => c[0] === 'terminal.run')).toHaveLength(1)
    const api = (await store.task('WH-2'))!
    await store.saveTask({ ...api, links: [{ label: 'PR', url: 'https://github.com/o/r/pull/7' }], step: { ...initialState(), started: true, done: true } })
    await resumeParked(deps)
    const line = String(calls.filter(c => c[0] === 'terminal.run')[1]![1].line)
    expect(line).toContain(`'--resume' '${run.session}'`)
    expect(line).toContain('WH-2 (API) is done, PR https://github.com/o/r/pull/7.')
    expect((await store.task('WH-1'))!.parked).toBeUndefined()
  })

  it('a wait that would close a cycle is refused: not parked, the worker told, one decision wake', async () => {
    const { store, calls, env, deps } = await setup({ after: 'WH-1' })
    env.label = 'blocked:on WH-2: the shared schema'
    await advanceTick(deps, 1000)
    env.label = 'blocked:on WH-2: the shared schema'
    await advanceTick(deps, 2000)
    const t = (await store.task('WH-1'))!
    expect(t.parked).toBeUndefined()
    expect(t.after).toBeUndefined()
    expect(woken).toHaveLength(1)
    expect(woken[0]).toMatch(/^Decision: /)
    expect(calls.filter(c => c[0] === 'terminal.send').map(c => c[1].text)).toEqual(Array(2).fill(expect.stringContaining('already waits for this task')))
    expect(calls.some(c => c[0] === 'terminal.kill')).toBe(false)
  })
})
