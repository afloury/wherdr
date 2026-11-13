import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPmStore } from '../server/utils/pmStore'
import { splitFeature } from '../server/utils/pmFeature'
import { afterRefusal, closeRefusal, featureState, parsePlan } from '../shared/pm/feature'
import { parseCommand } from '../shared/pm/coordinator'
import type { Project } from '../shared/pm/project'
import type { Task } from '../shared/pm/run'

const projects = [
  { key: 'WS', name: 'Work', machine: '', path: '/src/work', kind: 'workspace', git: false, addedAt: 1 },
  { key: 'PA', name: 'Payroll', machine: '', path: '/src/work/payroll-api', workspace: 'WS', addedAt: 1 },
  { key: 'QA', name: 'Quotes', machine: '', path: '/src/work/quotes-app', workspace: 'WS', addedAt: 1 },
  { key: 'OT', name: 'Other', machine: '', path: '/src/other', addedAt: 1 },
] as Project[]
const sub = (id: string, more: Partial<Task> = {}) => ({ id, project: id.split('-')[0]!, title: id, description: '', type: 'feature', state: 'todo', createdAt: 1, feature: 'WS-1', ...more }) as Task
const plan = (tasks: object[]) => ({ order: 'The API first: the app calls it', tasks })

describe('features: the plan, after and the derived state', () => {
  it('parses the commands and puts a plan in start order', () => {
    expect(parseCommand(['feature', 'add', 'Export', 'payslips', '--description', 'As PDF', '--project', 'WS'])).toEqual({ name: 'feature add', title: 'Export payslips', description: 'As PDF', project: 'WS' })
    expect(parseCommand(['feature', 'close', 'WS-1', '--reason', 'Shipped'])).toEqual({ name: 'feature close', task: 'WS-1', reason: 'Shipped' })
    expect(parseCommand(['task', 'edit', 'PA-1', '--after', 'QA-1', '--reason', 'The app first'])).toMatchObject({ after: 'QA-1' })
    const p = parsePlan(plan([{ repo: 'quotes-app', title: 'Show it', type: 'feature', after: ['payroll-api'] }, { repo: 'payroll-api', title: 'Serve it', type: 'feature' }]))
    expect('tasks' in p && p.tasks.map(t => t.repo)).toEqual(['payroll-api', 'quotes-app'])
    expect(parsePlan(plan([{ repo: 'a', title: 'A', type: 'x', after: ['b'] }, { repo: 'b', title: 'B', type: 'x', after: ['a'] }]))).toEqual({ error: 'plan: a cycle in after (a, b)' })
    expect(parsePlan(plan([{ repo: 'a', title: 'A', type: 'x' }, { repo: 'a', title: 'B', type: 'x' }]))).toMatchObject({ error: expect.stringMatching(/twice/) })
  })

  it('links after across the workspace only, never into a cycle', () => {
    const tasks = [sub('PA-1'), sub('QA-1', { after: 'PA-1' }), sub('OT-1'), { ...sub('WS-1'), kind: 'feature' as const }]
    expect(afterRefusal('QA', ['PA-1'], tasks, projects)).toBeUndefined()
    expect(afterRefusal('QA', ['OT-1'], tasks, projects)).toMatch(/tasks of the same project or workspace, comma-separated \(not OT-1\)/)
    expect(afterRefusal('PA', ['WS-1'], tasks, projects)).toMatch(/not WS-1/)
    expect(afterRefusal('PA', ['QA-1'], tasks, projects, 'PA-1')).toMatch(/a cycle/)
  })

  it('derives the feature\'s state from its sub-tasks, done once closed', () => {
    const f = { ...sub('WS-1'), feature: undefined, kind: 'feature' as const }
    const done = sub('PA-1', { step: { at: 0, started: true, done: true, proofs: {}, rounds: {} } })
    expect(featureState(f, [sub('PA-1')])).toBe('todo')
    expect(featureState(f, [done, sub('QA-1', { state: 'working' })])).toBe('working')
    expect(featureState(f, [done, sub('QA-1', { state: 'waiting', waiting: 'A question' })])).toBe('waiting')
    expect(closeRefusal(f, [done, sub('QA-1')])).toMatch(/QA-1 still open/)
    expect(closeRefusal(f, [done])).toBeUndefined()
    expect(featureState({ ...f, closed: { at: 1, by: 'x' } }, [done])).toBe('done')
  })
})

describe('feature split', () => {
  let dir = ''
  beforeEach(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pm-feature-')) })
  afterEach(() => fs.rm(dir, { recursive: true, force: true }))

  it('in one call adds one sub-task per repository, chains them and starts those that wait for nothing; all or nothing', async () => {
    const store = createPmStore(dir)
    await store.setEnabled(true)
    await fs.writeFile(store.files.projects, JSON.stringify({ v: 1, projects }))
    const feature = await store.addTask({ project: 'WS', title: 'Export payslips', type: 'feature' })
    expect(feature).toMatchObject({ id: 'WS-1', kind: 'feature' })
    const ws = projects[0]!, start = vi.fn(async () => {}), who = { by: 'coordinator WS', origin: 'user' as const }
    const split = (p: object) => splitFeature({ store } as never, ws, feature, JSON.stringify(p), who, start)
    // Refused whole: an unknown task type, a link outside the workspace.
    await expect(split(plan([{ repo: 'payroll-api', title: 'Serve', type: 'task' }, { repo: 'QA', title: 'Show', type: 'study' }]))).rejects.toThrow(/no task type "study"/)
    await store.addTask({ project: 'OT', title: 'Elsewhere', type: 'task' })
    await expect(split(plan([{ repo: 'payroll-api', title: 'Serve', type: 'task' }, { repo: 'QA', title: 'Show', type: 'task', after: ['OT-1'] }]))).rejects.toThrow(/after/)
    expect((await store.tasks()).filter(t => t.feature)).toEqual([])

    const r = await split(plan([{ repo: 'QA', title: 'Show it', type: 'task', after: ['payroll-api'] }, { repo: 'payroll-api', title: 'Serve it', type: 'task', files: ['api'] }]))
    expect(r.tasks).toEqual([{ id: 'PA-1', project: 'PA', title: 'Serve it' }, { id: 'QA-1', project: 'QA', title: 'Show it', after: 'PA-1' }])
    expect(r.started).toEqual(['PA-1'])
    expect(start).toHaveBeenCalledTimes(1)
    expect(await store.task('PA-1')).toMatchObject({ feature: 'WS-1', files: ['api'] })
    expect(await store.task('WS-1')).toMatchObject({ plan: { order: 'The API first: the app calls it' } })
    await expect(split(plan([{ repo: 'QA', title: 'Again', type: 'task' }]))).rejects.toThrow(/already split/)
  })
})
