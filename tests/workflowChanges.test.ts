import { expect, it } from 'vitest'
import { changeHeadline, changeSummary, changeTitle, impactRepeats, stepMarks, taskImpact, typeBefore, workflowChanges } from '../shared/pm/workflowChanges'
import { workerPlan } from '../shared/pm/run'
import { defaultWorkflow, type Template } from '../shared/pm/workflow'

const old: Template = {
  id: 'w',
  guards: { merge: { others: 'user' } },
  steps: { review: { id: 'review', holder: 'reviewer', ends: 'verdict', instructions: 'Read the diff.\nSay pass.' } },
  taskTypes: {
    task: { steps: [{ id: 'todo' }, { id: 'work', holder: 'worker', ends: 'report' }, 'review', { id: 'old', holder: 'coordinator' }, { id: 'done' }] },
    tiny: { steps: [{ id: 'todo' }, { id: 'done' }] },
  },
}

it('lists, per type, the steps added, removed and changed, and each changed field', () => {
  const next: Template = {
    ...old,
    guards: { merge: { others: 'engine' } },
    steps: { review: { ...old.steps!.review!, instructions: 'Read the diff.\nRun the tests.\nSay pass.' } },
    taskTypes: {
      task: { steps: [{ id: 'todo' }, { id: 'work', holder: 'coordinator', ends: 'report' }, 'review', { id: 'land', ends: 'action', action: { kind: 'github.merge', checks: ['smoke'] } }, { id: 'done' }] },
      big: { steps: [{ id: 'todo' }] },
    },
  }
  const c = workflowChanges(old, next)
  expect(c.all).toEqual([{ field: 'merge', before: 'you', after: 'automatic' }])
  expect(c.types.map(t => [t.type, t.kind])).toEqual([['task', 'changed'], ['tiny', 'removed'], ['big', 'added']])
  // The new step list, a removed step before the next one kept.
  expect(c.types[0]!.steps.map(s => [s.id, s.kind])).toEqual([['todo', 'same'], ['work', 'changed'], ['review', 'changed'], ['land', 'added'], ['old', 'removed'], ['done', 'same']])
  expect(c.types[0]!.steps[1]!.fields).toEqual([{ field: 'holder', before: 'worker', after: 'coordinator' }])
  expect(c.types[0]!.steps[2]!.fields).toEqual([{ field: 'instructions', before: 'Read the diff.\nSay pass.', after: 'Read the diff.\nRun the tests.\nSay pass.' }])
  expect(changeSummary(c, 9)).toEqual([
    'all types: merge: you → automatic',
    'task: work holder: worker → coordinator, review instructions edited, + land, − old',
    'type tiny removed',
    '+ type big (1 step, automatic merge)',
  ])
  expect(changeSummary(c)).toEqual(['all types: merge: you → automatic', 'and 3 more changes'])
})

it('a type-level guard and an action read in plain words; an unchanged workflow lists nothing', () => {
  const next: Template = { ...old, taskTypes: { ...old.taskTypes, tiny: { guards: { merge: { others: 'engine' } }, steps: [{ id: 'todo' }, { id: 'land', ends: 'action', action: { kind: 'github.merge', checks: ['smoke'] } }, { id: 'done' }] } } }
  expect(changeSummary(workflowChanges(old, next))).toEqual(['tiny: merge: none → automatic, + land'])
  expect(workflowChanges(old, next).types[0]!.steps[1]).toMatchObject({ id: 'land', kind: 'added', ends: 'action' })
  expect(workflowChanges(old, old)).toEqual({ all: [], types: [] })
})

it('a step moved among the others reads as moved', () => {
  const steps = old.taskTypes.task!.steps
  const next: Template = { ...old, taskTypes: { ...old.taskTypes, task: { steps: [steps[0]!, steps[2]!, steps[1]!, steps[3]!, steps[4]!] } } }
  const c = workflowChanges(old, next)
  expect(c.types[0]!.steps.map(s => [s.id, s.kind])).toEqual([['todo', 'same'], ['review', 'same'], ['work', 'moved'], ['old', 'same'], ['done', 'same']])
  expect(changeSummary(c)).toEqual(['task: work moved'])
})

it('titles a proposal by what it does: first workflow, types only added or removed, else a change', () => {
  const add = (t: Template, ...types: string[]): Template => ({ ...t, taskTypes: { ...t.taskTypes, ...Object.fromEntries(types.map(k => [k, { steps: [{ id: 'todo' }, { id: 'done' }] }])) } })
  const { tiny: _, ...rest } = old.taskTypes
  expect(changeTitle(workflowChanges(old, add(old, 'release')))).toBe('New task type')
  expect(changeTitle(workflowChanges(old, add(old, 'release', 'docs')))).toBe('New task types')
  expect(changeTitle(workflowChanges(old, { ...old, taskTypes: rest }))).toBe('Task type removed')
  expect(changeTitle(workflowChanges(old, { ...old, taskTypes: {} }))).toBe('Task types removed')
  expect(changeTitle(workflowChanges(null, old))).toBe('First workflow')
  expect(changeTitle(workflowChanges(defaultWorkflow('CO'), add(old, 'release')))).toBe('First workflow')
  expect(changeTitle(workflowChanges(old, { ...add(old, 'release'), guards: { merge: { others: 'engine' } } }))).toBe('Workflow change')
})

it('per-program models read in plain words, mark the worker step, and the impact does not repeat the headline', () => {
  const was: Template = { ...old, prefs: { agent: 'claude', model: 'opus', reviewAgent: 'codex', reviewModel: 'gpt-6.1' } }
  const next: Template = { ...was, prefs: { ...was.prefs, models: { codex: 'gpt-6.1-sol' } } }
  const c = workflowChanges(was, next)
  expect(changeHeadline(c)).toBe('all types: If the task runs Codex: gpt-6.1-sol (was: the workflow\'s model)')
  expect(changeSummary(workflowChanges(next, was))).toEqual(['all types: If the task runs Codex: the workflow\'s model (was: gpt-6.1-sol)'])
  const marks = stepMarks(c, 'task', next)
  expect(marks.get('work')).toMatchObject({ kind: 'changed', fields: [{ field: 'models.codex', after: 'gpt-6.1-sol' }] })
  // The reviewer's model is reviewModel, whatever its program.
  expect(marks.get('review')!.kind).toBe('same')
  expect(taskImpact(c, 'task', next)).toBe('For task tasks: work changes its model if the task runs Codex')
  const guard = workflowChanges(old, { ...old, guards: { merge: { others: 'engine' } } })
  expect(impactRepeats(taskImpact(guard, 'task', old), changeHeadline(guard))).toBe(true)
  expect(impactRepeats(taskImpact(c, 'task', next), changeHeadline(c))).toBe(false)
})

it('a removed type with its own prefs and a workflow-wide model: both in the headline, its worker as it was', () => {
  const study = { steps: [{ id: 'todo' }, { id: 'work', holder: 'worker' as const, ends: 'report' as const }, { id: 'done' }], prefs: { agent: 'codex', model: 'gpt-6.1-sol' } }
  const was: Template = { ...old, prefs: { agent: 'claude', model: 'opus' }, taskTypes: { ...old.taskTypes, 'study-codex': study } }
  const next: Template = { ...old, prefs: { agent: 'claude', model: 'opus', models: { codex: 'gpt-6.1-sol' } } }
  const c = workflowChanges(was, next)
  expect(changeTitle(c)).toBe('Workflow change')
  expect(changeHeadline(c)).toBe('Type study-codex removed · If the task runs Codex: gpt-6.1-sol (was: the workflow\'s model)')
  expect(workerPlan(next, { type: 'study-codex' })).toHaveProperty('reason')
  expect(workerPlan(typeBefore(c, 'study-codex', next)!, { type: 'study-codex' })).toMatchObject({ program: 'codex', model: 'gpt-6.1-sol' })
  // The type's prefs first, then the workflow's as it was (no per-program model yet).
  const plain = workflowChanges({ ...was, taskTypes: { ...was.taskTypes, 'study-codex': { steps: study.steps } } }, next)
  expect(workerPlan(typeBefore(plain, 'study-codex', next)!, { type: 'study-codex' })).toMatchObject({ program: 'claude', model: 'opus' })
  expect(typeBefore(plain, 'study-codex', next)!.prefs).toEqual({ agent: 'claude', model: 'opus' })
})
