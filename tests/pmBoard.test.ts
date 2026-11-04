import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { createPmStore } from '../server/utils/pmStore'
import { board, userStep } from '../server/utils/pmBoard'
import { company } from '../shared/pm/examples'
import type { CoreAdminDeps } from '../server/utils/coreCreate'

let dir = ''
afterEach(() => fs.rm(dir, { recursive: true, force: true }))

// "Merged" runs the step's git.verify-merged at once; with no worktree to check,
// the step stays open and the card stays in Your turn, saying why.
it('the Merged button runs the step\'s check, and a failed check stays in Your turn', async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pm-board-'))
  const store = createPmStore(dir)
  await store.setEnabled(true)
  await store.saveTemplate(company)
  await fs.writeFile(store.files.projects, JSON.stringify({ v: 1, projects: [{ key: 'CO', name: 'Company', machine: '', path: '/src/co', template: 'company', addedAt: 1 }] }))
  const task = await store.addTask({ project: 'CO', title: 'Fix it', type: 'feature' })
  await store.saveTask({ ...task, state: 'working', step: { at: 4, started: true, proofs: {}, rounds: {}, yourTurn: { reason: 'user', badge: 'Merge the PR' } } })

  const deps = { store } as unknown as CoreAdminDeps & { store: typeof store }
  const after = await userStep(deps, task.id)
  expect(after.step).toMatchObject({ at: 4, yourTurn: { reason: 'action', badge: 'Merge the PR: No worktree: the task never started' } })
  expect(after.step?.acting).toBeUndefined()
  const { cards, projects } = await board(store)
  expect(projects[0]!.columns).toEqual(['To do', 'Working', 'Review', 'Deploy', 'Done'])
  expect(cards[0]).toMatchObject({ column: 'Review', step: 'merge', holder: 'none', userLabel: 'Merged', yourTurn: 'Merge the PR: No worktree: the task never started' })
})
