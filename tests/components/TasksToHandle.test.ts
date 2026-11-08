// WHR-52: the sidebar's Tasks to handle lists the tasks waiting for the user
// as task rows (id, title, what to do, a short action, no agent status), and a
// tap opens the task's sheet on the board; with none, the section is hidden.
import { afterEach, expect, it, vi } from 'vitest'
import { mockNuxtImport, mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import TasksToHandle from '~/components/TasksToHandle.vue'
import type { ToHandle } from '#shared/pm/board'

const { navigate } = vi.hoisted(() => ({ navigate: vi.fn() }))
mockNuxtImport('navigateTo', () => navigate)
let list: ToHandle[] = []
registerEndpoint('/api/pm/handle', () => list)
afterEach(() => { navigate.mockReset() })

it('lists each task waiting for the user, and a tap opens its sheet on the board', async () => {
  list = [
    { id: 'CO-2', shown: 'CO-2', title: 'Dark mode toggle', action: 'Look at the screenshots, then merge', label: 'Merge' },
    { id: 'CO-4', shown: 'CO-4', title: 'Fix login redirect', action: 'Stalled: CI red, no new push for 15 min', label: 'Unblock' },
  ]
  const w = await mountSuspended(TasksToHandle)
  await expect.poll(() => w.findAll('.handle-row').length).toBe(2)
  expect(w.find('.group-title').text()).toBe('Tasks to handle2')
  const row = w.find('[data-task="CO-4"]')
  expect([row.find('.handle-id').text(), row.find('.handle-title').text(), row.find('.handle-action').text(), row.find('.handle-label').text()])
    .toEqual(['CO-4', 'Fix login redirect', 'Stalled: CI red, no new push for 15 min', 'Unblock'])
  expect(w.find('.card-state').exists()).toBe(false) // a task, not an agent
  await row.trigger('click')
  expect(navigate).toHaveBeenCalledWith({ path: '/board', query: { task: 'CO-4' } })
  w.unmount()
})

it('is hidden when nothing waits for the user', async () => {
  list = []
  const w = await mountSuspended(TasksToHandle)
  await new Promise(r => setTimeout(r, 50))
  expect(w.find('[data-testid="tasks-to-handle"]').exists()).toBe(false)
  w.unmount()
})
