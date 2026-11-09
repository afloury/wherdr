// WHR-52: the sidebar's Tasks to handle lists the tasks waiting for the user
// as task rows (id, title, what to do, a short action, no agent status); with
// none, the section is hidden. WHR-145: a tap goes where the user acts: an
// agent's question or permission opens its conversation, anything else the
// task's sheet (its To do tab); the sheet stays one tap away.
import { afterEach, expect, it, vi } from 'vitest'
import { mockNuxtImport, mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import TasksToHandle from '~/components/TasksToHandle.vue'
import { herdrState } from '~/composables/useHerdr'
import { coordinators } from '~/composables/useCoordinators'
import { machineBarSaved, machineGroups } from '~/composables/useMachineBar'
import type { Pane } from '#shared/types'
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
  expect([row.find('[data-testid="project-badge"]').text(), row.find('.handle-title').text(), row.find('.handle-action').text(), row.find('.handle-label').text()])
    .toEqual(['CO-4', 'Fix login redirect', 'Stalled: CI red, no new push for 15 min', 'Unblock'])
  expect(w.find('.card-state').exists()).toBe(false) // a task, not an agent
  await row.find('.handle-row').trigger('click')
  expect(navigate).toHaveBeenCalledWith({ path: '/board', query: { task: 'CO-4' } })
  w.unmount()
})

it('follows the home tab: a personal tab hides a work project\'s tasks, All shows all (WHR-152)', async () => {
  coordinators.value = [{ project: 'home', name: 'Home', machines: ['laptop'] }, { project: 'work', name: 'Work', machines: ['office'] }]
  machineGroups.value = [{ id: '*group:personal', name: 'Personal', machines: ['laptop'] }, { id: '*group:work', name: 'Work', machines: ['office'] }]
  list = [
    { id: 'HO-1', shown: 'HO-1', project: 'home', title: 'Home task', action: 'Merge', label: 'Merge' },
    { id: 'WK-1', shown: 'WK-1', project: 'work', title: 'Work task', action: 'Merge', label: 'Merge' },
  ]
  try {
    machineBarSaved.value = '*group:personal'
    const w = await mountSuspended(TasksToHandle)
    const shown = () => w.findAll('[data-task]').map(r => r.attributes('data-task'))
    await expect.poll(shown).toEqual(['HO-1'])
    machineBarSaved.value = '*'
    await expect.poll(shown).toEqual(['HO-1', 'WK-1'])
    w.unmount()
  } finally { coordinators.value = []; machineGroups.value = []; machineBarSaved.value = null }
})

it('is hidden when nothing waits for the user', async () => {
  list = []
  const w = await mountSuspended(TasksToHandle)
  await new Promise(r => setTimeout(r, 50))
  expect(w.find('[data-testid="tasks-to-handle"]').exists()).toBe(false)
  w.unmount()
})

it('goes where the user acts: an asking agent\'s conversation, else the task\'s sheet', async () => {
  const pane = (id: string, coreAddress: string) => ({ id, coreAddress, status: 'blocked', agent: 'claude', workspace: 'w', tab: 't' }) as Pane
  herdrState.value = { ok: true, workspaces: [], panes: [pane('w1:p1', 'host-a/t1'), pane('m2~w1:p4', 'host-b/t4')] }
  list = [
    { id: 'CO-1', shown: 'CO-1', title: 'Answer', action: 'Which database?', label: 'Answer', terminal: 'host-a/t1' },
    { id: 'CO-5', shown: 'CO-5', title: 'Permission, another machine', action: 'Run npm install?', label: 'Answer', terminal: 'host-b/t4' },
    { id: 'CO-2', shown: 'CO-2', title: 'Merge', action: 'Look at the screenshots, then merge', label: 'Merge' },
    { id: 'CO-3', shown: 'CO-3', title: 'Retry', action: 'Merge refused', label: 'Retry' },
    { id: 'CO-6', shown: 'CO-6', title: 'Check', action: 'Check review: over 90m', label: 'Check' },
    { id: 'CO-7', shown: 'CO-7', title: 'Agent gone', action: 'Which branch?', label: 'Answer', terminal: 'host-c/t9' },
  ]
  const w = await mountSuspended(TasksToHandle)
  await expect.poll(() => w.findAll('.handle-row').length).toBe(6)
  const target = async (id: string) => { navigate.mockReset(); await w.find(`[data-task="${id}"] .handle-row`).trigger('click'); return navigate.mock.calls[0]![0] }
  expect(await target('CO-1')).toBe('/a/w1%3Ap1')
  expect(await target('CO-5')).toBe('/a/m2~w1%3Ap4')
  for (const id of ['CO-2', 'CO-3', 'CO-6', 'CO-7']) expect(await target(id)).toEqual({ path: '/board', query: { task: id } })
  // The sheet one tap away, only on a row that opens an agent.
  expect(w.findAll('[data-testid="handle-sheet"]').map(b => b.element.closest('[data-task]')!.getAttribute('data-task'))).toEqual(['CO-1', 'CO-5'])
  navigate.mockReset()
  await w.find('[data-task="CO-1"] [data-testid="handle-sheet"]').trigger('click')
  expect(navigate).toHaveBeenCalledWith({ path: '/board', query: { task: 'CO-1' } })
  w.unmount()
  herdrState.value = { ok: false, workspaces: [], panes: [] }
})
