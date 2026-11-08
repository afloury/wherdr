import { expect, it } from 'vitest'
import { guardEffects } from '../shared/pm/guardEffects'
import type { Template } from '../shared/pm/workflow'

const t: Template = {
  id: 'web',
  version: 1,
  steps: { land: { id: 'land', holder: 'none', ends: 'action', action: { kind: 'git.land', target: 'dev' } } },
  taskTypes: {
    feature: {
      guards: { protected: ['develop'], merge: { others: 'user' } },
      steps: [
        { id: 'work', holder: 'worker', ends: 'report' },
        { id: 'pr', holder: 'none', ends: 'action', action: { kind: 'github.pr' } },
        { id: 'merge', holder: 'none', ends: 'action', action: { kind: 'github.merge' } },
      ],
    },
    fix: { steps: ['land'] },
  },
}

it('lists what each task type adds and who merges at each merging step, the PR base from the project', () => {
  expect(guardEffects(t, { protected: ['main'] }, 'main')).toEqual({
    types: [{ type: 'feature', protects: ['develop'], merge: { others: 'user' } }],
    steps: [
      { type: 'feature', step: 'merge', into: 'main', by: 'user' },
      { type: 'fix', step: 'land', into: 'dev', by: 'engine' },
    ],
  })
})

it('follows the guards being edited at once', () => {
  const g = guardEffects(t, { protected: ['main', 'dev'], merge: { protected: 'engine', others: 'user' } }, 'main')
  // The task type asks what the project already says: nothing to add.
  expect(g.types).toEqual([{ type: 'feature', protects: ['develop'], merge: {} }])
  expect(g.steps.map(s => s.by)).toEqual(['engine', 'engine'])
})
