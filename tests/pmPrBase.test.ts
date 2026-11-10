// The branch line's PR base: kept on the task, read for a PR its worker opened, kept once done.
import { expect, it, vi } from 'vitest'
import { keepPrBase } from '../server/utils/pmMechanic'
import { branchLine, cardOf } from '../shared/pm/board'
import { hasPrLink, type Run, type Task } from '../shared/pm/run'
import { initialState, planSteps } from '../shared/pm/steps'
import { company, wherdr } from '../shared/pm/examples'
import type { PrInfo } from '../shared/pm/actions'
import type { PmStore } from '../server/utils/pmStore'

const task: Task = { id: 'CO-1', project: 'CO', title: 'A task', description: '', type: 'feature', state: 'working', createdAt: 1, step: { ...initialState(), started: true, at: 1 } }
const pr = (base: string): PrInfo => ({ url: 'https://github.com/o/r/pull/3', baseRefName: base, headRefOid: 'h', commits: [{}, {}] })

it('a PR its worker linked in a report is read too, not only one a PR step opened', () => {
  expect(hasPrLink(task)).toBe(false)
  expect(hasPrLink({ ...task, step: { ...task.step!, proofs: { work: { link: 'https://github.com/o/r/pull/3' } } } })).toBe(true)
  expect(hasPrLink({ ...task, links: [{ label: 'Ticket', url: 'https://example.com/t/1' }] })).toBe(false)
})

it('keeps the PR\'s base on the task, saved only when it changes', async () => {
  const saveTask = vi.fn(async (t: Task) => t)
  const store = { saveTask } as unknown as PmStore
  const kept = await keepPrBase(store, task, pr('v3'))
  expect(kept.prBase).toEqual({ base: 'v3', commits: 2 })
  await keepPrBase(store, kept, pr('v3'))
  expect(saveTask).toHaveBeenCalledTimes(1)
  expect((await keepPrBase(store, kept, undefined)).prBase).toBeUndefined()
})

it('a done task still says where its PR went, not where the workflow would send it', () => {
  // The worker's PR to v3 on a workflow that checks develop; a merged PR to develop on one that opens it to v3.
  const run: Run = { id: 'r', task: 'CO-1', role: 'worker', program: 'claude', model: 'm', machine: '', worktree: '/w', branch: 'task/CO-1', instructions: '/i', attempt: 1, state: 'ended', startedAt: 1 }
  const co = cardOf({ ...task, prBase: { base: 'v3' } }, planSteps(company, { type: 'feature' }, 'develop'), [run])
  expect(branchLine(co, 'develop')?.base).toBe('v3')
  const plan = planSteps(wherdr, { type: 'simple' }, 'v3')
  const done = cardOf({ ...task, type: 'simple', prBase: { base: 'develop' }, step: { ...initialState(), started: true, at: plan.length - 1, done: true } }, plan, [run])
  expect(branchLine(done, 'v3')?.base).toBe('develop')
})
