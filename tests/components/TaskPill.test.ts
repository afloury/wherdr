// The task id pill in a task agent's header opens the task's actions: state and step, the waiting
// step's button (the task sheet's request) and Open the task.
import { expect, it } from 'vitest'
import { mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import { readBody } from 'h3'
import { useRouter } from '#app'
import TaskPill from '~/components/TaskPill.vue'
import type { Board, Card } from '#shared/pm/board'

const card = { id: 'CO-4', shown: 'CO-4', project: 'co', title: 'Fix login redirect', column: 'merge', phase: 'working', holder: 'none', yourTurn: 'Look at the screenshots, then merge', plan: [{ id: 'build' }, { id: 'ship' }], step: 'ship', state: { started: true, at: 1, yourTurn: { reason: 'user' } }, userLabel: 'Merge' } as unknown as Card
const pressed: unknown[] = []
registerEndpoint('/api/pm/board', (): Board => ({ projects: [], cards: [card] }))
registerEndpoint('/api/pm/step-user', { method: 'POST', handler: async (e) => { pressed.push(await readBody(e)); return { ok: true } } })

it('opens the task actions from the pill: state, the step button, Open the task', async () => {
  const w = await mountSuspended(TaskPill, { props: { task: 'CO-4', text: 'CO-4' }, attachTo: document.body })
  await expect.poll(() => w.find('[data-testid="task-pill"]').exists()).toBe(true)
  expect(document.querySelector('[data-testid="task-pill-menu"]')).toBeNull()
  await w.find('[data-testid="task-pill"]').trigger('click')
  await expect.poll(() => document.querySelector('[data-testid="task-pill-menu"]')).not.toBeNull()
  expect(document.querySelector('[data-testid="task-pill-state"]')!.textContent).toBeTruthy()
  const step = document.querySelector<HTMLButtonElement>('[data-testid="task-pill-step"]')!
  expect(step.textContent).toContain('Merge')
  step.click()
  await expect.poll(() => pressed.length).toBe(1)
  document.querySelector<HTMLButtonElement>('[data-testid="task-pill-open"]')!.click()
  await expect.poll(() => useRouter().currentRoute.value.fullPath).toBe('/?task=CO-4')
  w.unmount()
  await useRouter().replace('/')
}, 40000)
