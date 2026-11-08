import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { createPmStore } from '../server/utils/pmStore'
import { advanceTick } from '../server/utils/pmAdvance'
import { mechanicTick } from '../server/utils/pmMechanic'
import { cleanTask } from '../server/utils/pmCleanup'
import { READ_SEP } from '../shared/pm/advance'
import { github } from '../shared/pm/examples'
import { initialState, onEvent, planSteps } from '../shared/pm/steps'
import type { Run } from '../shared/pm/run'

// A project on the wherdr host whose task runs on machine B: everything done
// for that run (signal read, actions, reviewer, login check, cleanup) goes to B.
let dir = '', calls: [string, Record<string, unknown>][] = []
const terms: Record<string, Record<string, string>> = {}
const machines = () => [{ key: '', local: true, label: 'host' }, { key: 'b', local: false, status: 'online', label: 'machine-b' }]
const call = async (method: string, p: Record<string, unknown>) => {
  calls.push([method, p])
  if (method === 'terminal.list') return { terminals: Object.entries(terms).map(([address, labels]) => ({ address, labels })) }
  if (method === 'terminal.label') Object.assign(terms[p.terminal as string] ?? {}, p.labels)
  if (method === 'terminal.run') { terms['b/t2'] = {}; return { address: 'b/t2' } }
  if (method === 'terminal.get') return { state: 'running' }
  if (method !== 'machine.exec') return {}
  const script = (p.argv as string[])[2]!
  const out = script.includes(READ_SEP) ? ['abc1234', '5', '', ''].join(`\n${READ_SEP}\n`)
    : script.includes('gh pr create') ? 'https://github.com/o/r/pull/9'
      : script.includes('$HOME') ? '/h' : script.includes('worktree list') ? '1 1 0 0' : ''
  // The login check fails: the task stays waiting, nothing restarts.
  return { code: script.includes('--contains') || script.includes('auth status') ? 1 : 0, stdout: Buffer.from(out).toString('base64') }
}
const store = () => createPmStore(dir)
const deps = () => ({ store: store(), call, machines, launchWatchMs: 0 }) as unknown as Parameters<typeof advanceTick>[0]
const worker = (more: Partial<Run> = {}): Run => ({ id: 'r1', task: 'CO-1', role: 'worker', program: 'claude', model: 'sonnet', machine: 'b', worktree: '/h/.wherdr/pm/worktrees/CO-1', branch: 'task/CO-1', instructions: '/h/.wherdr/pm/tasks/CO-1/instructions.md', terminal: 'b/t1', attempt: 1, state: 'running', startedAt: 1, ...more })
const execs = () => calls.filter(([m]) => m === 'machine.exec' || m === 'terminal.run').map(([, p]) => p.on)

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pm-run-machine-'))
  calls = []
  for (const k of Object.keys(terms)) delete terms[k]
  await store().setEnabled(true)
  await store().saveTemplate(github)
})
afterEach(() => fs.rm(dir, { recursive: true, force: true }))

async function setup(machine = '') {
  await store().addProject({ key: 'CO', machine, path: '/src', template: 'github' }, async (_m, p) => p)
  return store().addTask({ project: 'CO', title: 'Fix', type: 'simple' })
}

it('reads the signal, runs the PR action and starts the reviewer on the run\'s machine', async () => {
  const t = await setup()
  const plan = planSteps(github, { type: 'simple' })
  const first = onEvent(plan, initialState(), { kind: 'start' }, 1).state
  await store().saveRun(worker())
  await store().saveTask({ ...t, state: 'working', run: 'r1', step: { ...first, told: first.since } })
  terms['b/t1'] = { 'wherdr.report': 'done' }
  await advanceTick(deps()) // the signal, then the PR
  await advanceTick(deps()) // the reviewer
  const task = (await store().task(t.id))!
  expect(task.step!.proofs.pr?.link).toBe('https://github.com/o/r/pull/9')
  expect(calls.find(([m]) => m === 'terminal.run')![1]).toMatchObject({ on: 'machine-b', labels: { 'wherdr.role': 'reviewer' } })
  expect(execs().length).toBeGreaterThan(3)
  expect(execs().every(on => on === 'machine-b')).toBe(true)
})

it('checks the login of a task waiting on it on the run\'s machine', async () => {
  const t = await setup()
  await store().saveRun(worker())
  await store().saveTask({ ...t, state: 'waiting', waitKind: 'auth', waiting: 'The agent is not logged in', run: 'r1', step: { at: 0, started: true, since: 1, proofs: {}, rounds: {} } })
  await mechanicTick(deps())
  const login = calls.find(([m, p]) => m === 'machine.exec' && (p.argv as string[])[2]!.includes('auth status'))
  expect(login?.[1]).toMatchObject({ on: 'machine-b', argv: expect.arrayContaining(['claude']) })
})

it('cleans up on the run\'s machine; a run elsewhere than the project keeps its worktree, with why', async () => {
  const t = await setup()
  const done = { ...t, state: 'done' as const, run: 'r1', step: { at: 9, started: true, since: 1, done: true, proofs: {}, rounds: {} } }
  await store().saveRun(worker({ state: 'ended' }))
  await store().saveTask(done)
  await cleanTask(deps(), t.id)
  expect(execs()).toEqual([])
  expect((await store().task(t.id))!.cleanup).toEqual({ skipped: 'it is on another machine than the project\'s, whose clone wherdr does not know yet' })

  // The project on B too: removed there.
  await fs.writeFile(store().files.projects, JSON.stringify({ v: 1, projects: [{ key: 'CO', name: 'CO', machine: 'b', path: '/src', template: 'github', addedAt: 1 }] }))
  await cleanTask(deps(), t.id)
  expect(execs().length).toBeGreaterThan(1)
  expect(execs().every(on => on === 'machine-b')).toBe(true)
  expect((await store().task(t.id))!.cleanup).toEqual({ done: true })
})
