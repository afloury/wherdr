import { describe, expect, it } from 'vitest'
import { inMergeQueue, mergeOrder, ordinal } from '../shared/pm/mergeQueue'
import { nextMove, type MechFacts, type PrState } from '../shared/pm/mechanic'
import { combineGuards } from '../shared/pm/guards'
import { cardStatus } from '../shared/pm/board'
import type { PlannedStep, StepState } from '../shared/pm/steps'
import type { Task } from '../shared/pm/run'

const plan: PlannedStep[] = [
  { id: 'work', holder: 'worker', ends: 'report', text: '' },
  { id: 'pr', ends: 'action', action: { kind: 'github.pr', base: 'v3' }, text: '' },
  { id: 'merge', ends: 'action', action: { kind: 'github.merge' }, text: '' },
]
const guards = combineGuards([{ source: 'project', guards: { protected: ['main'], merge: { others: 'engine' } } }])
const step = (more: Partial<StepState> = {}): StepState => ({ at: 2, started: true, proofs: {}, rounds: {}, ...more })
const task = (more: Partial<Task> = {}): Task => ({ id: 'CO-1', project: 'CO', title: 'Fix', description: '', type: 'feature', state: 'working', run: 'r1', createdAt: 0, step: step(), ...more })
const pr = (more: Partial<PrState> = {}): PrState => ({ url: 'https://gh/pr/7', baseRefName: 'v3', headRefOid: 'abc1234', mergeStateStatus: 'CLEAN', statusCheckRollup: [{ name: 'unit', status: 'COMPLETED', conclusion: 'SUCCESS' }], ...more })
const facts = (more: Partial<MechFacts> = {}): MechFacts => ({ task: task(), plan, guards, branch: 'task/CO-1', agentBusy: false, head: 'abc1234', pr: pr(), ...more })

describe('merge queue', () => {
  it('holds the tasks whose merge goes on: engine merges and approved waiting merges', () => {
    expect(inMergeQueue(task(), plan, guards, pr())).toBe(true)
    expect(inMergeQueue(task({ state: 'waiting' }), plan, guards, pr())).toBe(false)
    expect(inMergeQueue(task(), plan, guards, pr({ merged: true }))).toBe(false)
    const visual = plan.map(s => (s.id === 'merge' ? { ...s, ends: 'user' as const, guarded: true as const } : s))
    expect(inMergeQueue(task(), visual, guards, pr())).toBe(false)
    expect(inMergeQueue(task({ step: step({ approved: { by: 'user', at: 1 } }) }), visual, guards, pr())).toBe(true)
  })

  it('orders PRs touching no shared file first, then smaller diffs; the first keeps its place unless red', () => {
    const e = (id: string, files: string[], size: number, more = {}) => ({ id, files, size, ...more })
    const entries = [e('A', ['x.ts'], 10), e('B', ['x.ts', 'y.ts'], 5), e('C', ['z.ts'], 50), e('D', ['w.ts'], 20)]
    expect(mergeOrder(entries)).toEqual(['D', 'C', 'B', 'A'])
    // Its update or conflict resolution under way: it stays first.
    expect(mergeOrder(entries.map(x => (x.id === 'A' ? { ...x, first: true } : x)))).toEqual(['A', 'D', 'C', 'B'])
    // Red checks: back to its worker, after the others.
    expect(mergeOrder(entries.map(x => (x.id === 'D' ? { ...x, first: true, red: true } : x)))).toEqual(['C', 'B', 'A', 'D'])
    expect([1, 2, 3, 4, 11, 12, 21, 22].map(ordinal)).toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '21st', '22nd'])
  })

  it('updates only the first with its base, behind on GitHub or not, then merges it once its checks pass', () => {
    const catchUp = { key: 'catch-up:abc1234', move: { kind: 'catch-up', base: 'v3' } }
    expect(nextMove(facts({ queue: 1, behind: true }))).toEqual(catchUp)
    // A conflict goes the same way: the catch-up hands it to the worker, the task keeps its place.
    expect(nextMove(facts({ queue: 1, pr: pr({ mergeStateStatus: 'DIRTY' }) }))).toEqual(catchUp)
    // Waiting its turn: neither updated nor merged.
    expect(nextMove(facts({ queue: 2, behind: true, pr: pr({ mergeStateStatus: 'DIRTY' }) }))).toBeUndefined()
    expect(nextMove(facts({ queue: 2 }))).toBeUndefined()
    // Up to date: waits for its checks, then merges.
    const pending = pr({ statusCheckRollup: [{ name: 'unit', status: 'IN_PROGRESS' }] })
    expect(nextMove(facts({ queue: 1, pr: pending }))).toBeUndefined()
    expect(nextMove(facts({ queue: 1 }))).toEqual({ key: 'merge:abc1234', move: { kind: 'merge', url: 'https://gh/pr/7', base: 'v3' } })
    // Red after its update: back to its worker as red CI, not to the user.
    const red = pr({ statusCheckRollup: [{ name: 'unit', status: 'COMPLETED', conclusion: 'FAILURE' }] })
    expect(nextMove(facts({ queue: 1, pr: red }))?.move).toEqual({ kind: 'ci-to-agent', checks: ['unit'] })
  })

  it('shows its place on the card, and a refused merge waiting its turn is not the user\'s', () => {
    const refused = step({ yourTurn: { reason: 'action', badge: 'merge: the PR conflicts with v3', error: 'merge: the PR conflicts with v3' } })
    expect(cardStatus({ plan, state: refused, prNow: 'conflict', queue: 2 })?.text).toBe('2nd in merge queue')
    expect(cardStatus({ plan, state: step({ approved: { by: 'user', at: 1 } }), queue: 3 })?.text).toBe('Approved · 3rd in merge queue')
  })
})
