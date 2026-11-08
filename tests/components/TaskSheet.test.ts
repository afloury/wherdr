import { expect, it, vi } from 'vitest'
import { mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import TaskSheet from '~/components/TaskSheet.vue'
import { initialState } from '#shared/pm/steps'
import type { Card } from '#shared/pm/board'

const badge = 'Look at the screenshots, then merge: merge: the PR head is not the task\'s commit'
let release: () => void = () => {}
registerEndpoint('/api/pm/step-user', { method: 'POST', handler: async () => {
  await new Promise<void>((r) => { release = r })
  return { task: { id: 'WHR-1', step: { ...initialState(), started: true, at: 1, yourTurn: { reason: 'action', badge } } } }
} })

const card: Card = {
  id: 'WHR-1', project: 'WHR', title: 'A task', description: '', column: 'Merging', phase: 'working', step: 'merge', holder: 'none',
  yourTurn: 'Look at the screenshots, then merge', userLabel: 'Merge', tags: [], links: [], log: [], plan: [], state: { ...initialState(), started: true, at: 1 },
}
const stubs = { AppSheet: { template: '<section><slot /></section>' } }

it('shows the merge running, then a refusal in plain words under the button and on the badge', async () => {
  const w = await mountSuspended(TaskSheet, { props: { card }, global: { stubs } })
  await w.get('[data-testid="step-user"]').trigger('click')
  await vi.waitFor(() => expect(w.find('[data-testid="step-user-busy"]').exists()).toBe(true))
  release()
  const said = 'The PR on GitHub is not at the task\'s latest commit'
  await vi.waitFor(() => expect(w.get('[data-testid="step-user-refused"]').text()).toContain(said))
  expect(w.find('[data-testid="step-user-busy"]').exists()).toBe(false)
  expect(w.find('[data-testid="task-badge"]').exists()).toBe(false) // said once, under the button
  // The board read again: the badge carries the refusal, phrased the same; a new step clears it.
  await w.setProps({ card: { ...card, yourTurn: badge } })
  expect(w.get('[data-testid="step-user-refused"]').text()).toContain(said)
  await w.setProps({ card: { ...card, yourTurn: 'Deploy' } })
  expect(w.find('[data-testid="step-user-refused"]').exists()).toBe(false)
  expect(w.get('[data-testid="task-badge"]').text()).toBe('Deploy')
  await w.setProps({ card: { ...card, yourTurn: 'Merge: merge: 2 check(s) failed' } })
  expect(w.get('[data-testid="task-badge"]').text()).toContain('2 check(s) failed on the PR: the agent is asked to fix them')
  w.unmount()
})
