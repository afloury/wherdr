import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mockNuxtImport, mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import HomeView from '~/components/HomeView.vue'
import MachineBarSettings from '~/components/MachineBarSettings.vue'
import { collapsedMachines, eventsOpen, herdrState, hostLabel } from '~/composables/useHerdr'
import { machineBarHidden, machineBarOn, machineBarOrder, machineBarSaved } from '~/composables/useMachineBar'
import { BAR_ALL } from '~/utils/machineBar'
import type { MachineInfo, Pane } from '#shared/types'

const { navigate } = vi.hoisted(() => ({ navigate: vi.fn() }))
mockNuxtImport('navigateTo', () => navigate)

registerEndpoint('/api/machine/order', () => ({ order: [] }))
registerEndpoint('/api/machine/awake', () => ({ supported: false }))

const machine = (key: string, label: string, status: MachineInfo['status'] = 'online'): MachineInfo =>
  ({ key, label, local: key === '', status, error: null, session: 'default' })
const pane = (id: string, machineKey: string, status: Pane['status'] = 'idle'): Pane => ({
  id, workspace: id.split(':')[0]!, tab: `${id.split(':')[0]}:t1`, tabLabel: null, agent: 'claude', name: null, label: null,
  status, title: `Agent ${id}`, cwd: '/tmp/demo', agentSession: null, machine: machineKey,
})
const machines = [machine('', 'Server'), machine('laptop', 'Laptop'), machine('devbox', 'Devbox', 'offline')]
const panes = [
  pane('w1:p1', '', 'working'), pane('w2:p1', '', 'blocked'),
  pane('laptop/w1:p1', 'laptop', 'working'),
  pane('devbox/w1:p1', 'devbox'),
]
const workspaces = panes.map((p, i) => ({ id: p.workspace, number: i + 1, label: `space ${i + 1}`, focused: false, machine: p.machine }))

function setState() {
  herdrState.value = { ok: true, workspaces, panes, machines } as never
  eventsOpen.value = true
}
function reset() {
  for (const w of mounted) w.unmount()
  mounted = []
  machineBarOn.value = true
  machineBarOrder.value = []
  machineBarHidden.value = []
  machineBarSaved.value = null
  collapsedMachines.value = []
}
const pass = { template: '<div><slot /></div>' }
let mounted: { unmount: () => void }[] = []
const track = <T extends { unmount: () => void }>(w: T) => { mounted.push(w); return w }
const mountHome = async () => track(await mountSuspended(HomeView, { global: { stubs: { UContextMenu: pass, UTooltip: pass } } }))

describe('the machine bar on the home list', () => {
  beforeEach(() => { reset(); setState() })
  afterEach(() => { herdrState.value = { ok: false, workspaces: [], panes: [] }; eventsOpen.value = false; reset() })

  it('shows All first, then each machine with its state and count', async () => {
    const w = await mountHome()
    const items = w.findAll('.machine-bar-item')
    expect(items.map(i => i.find('.machine-bar-label').text())).toEqual(['All', 'Server', 'Laptop', 'Devbox'])
    expect(items.map(i => i.find('.machine-bar-count').text())).toEqual(['4', '2', '1', '1'])
    expect(items[0]!.classes()).toContain('on')
    expect(items[0]!.find('.machine-bar-state').exists()).toBe(false)
    expect(items[1]!.classes()).toContain('online')
    expect(items[3]!.classes()).toContain('offline')
    expect(w.findAll('section.machine').length).toBe(3)
  })

  it('a tap shows that machine only, and the choice is kept on the device', async () => {
    collapsedMachines.value = ['laptop']
    const w = await mountHome()
    await w.findAll('.machine-bar-item')[2]!.trigger('click')
    expect(w.findAll('section.machine').map(s => s.attributes('data-machine'))).toEqual(['laptop'])
    expect(w.findAll('.machine-bar-item')[2]!.attributes('aria-pressed')).toBe('true')
    // Folded, it would be a heading alone: it opens.
    expect(collapsedMachines.value).toEqual([])
    expect(localStorage.getItem('machineBarPick')).toBe('"laptop"')
    // The counters follow the machine shown.
    expect(w.findAll('.stats .stat b').map(b => b.text())).toEqual(['0', '1', '0'])
    // The local machine's key is empty, and still a machine of its own.
    await w.findAll('.machine-bar-item')[1]!.trigger('click')
    expect(w.findAll('section.machine').map(s => s.attributes('data-machine'))).toEqual(['local'])
    await w.findAll('.machine-bar-item')[0]!.trigger('click')
    expect(w.findAll('section.machine').length).toBe(3)
  })

  it('follows the settings: order, items taken off, turned off', async () => {
    machineBarOrder.value = ['laptop', BAR_ALL]
    machineBarHidden.value = ['']
    const w = await mountHome()
    expect(w.findAll('.machine-bar-label').map(i => i.text())).toEqual(['Laptop', 'All', 'Devbox'])
    // A machine off the bar still shows under All.
    expect(w.findAll('section.machine').length).toBe(3)
    machineBarOn.value = false
    await nextTick()
    expect(w.find('.machine-bar').exists()).toBe(false)
  })

  it('a choice taken off the bar falls back to its first item', async () => {
    machineBarSaved.value = 'laptop'
    machineBarHidden.value = ['laptop']
    const w = await mountHome()
    expect(w.find('.machine-bar-item.on .machine-bar-label').text()).toBe('All')
    expect(w.findAll('section.machine').length).toBe(3)
  })

  it('a single machine has the bar too: All, then that machine', async () => {
    // Herdr's state lists no machine when there is only this one.
    herdrState.value = { ok: true, workspaces: workspaces.slice(0, 2), panes: panes.slice(0, 2) } as never
    hostLabel.value = 'Server'
    const w = await mountHome()
    const items = w.findAll('.machine-bar-item')
    expect(items.map(i => i.find('.machine-bar-label').text())).toEqual(['All', 'Server'])
    expect(items.map(i => i.find('.machine-bar-count').text())).toEqual(['2', '2'])
    expect(items[1]!.classes()).toContain('online')
    // Choosing it keeps the whole list: it is the only machine.
    await items[1]!.trigger('click')
    expect(w.findAll('.card').length).toBeGreaterThan(0)
    hostLabel.value = ''
  })

  it('a single machine\'s menu opens its board', async () => {
    herdrState.value = { ok: true, workspaces: workspaces.slice(0, 2), panes: panes.slice(0, 2) } as never
    const w = await mountHome()
    navigate.mockClear()
    await w.find('.solo-machine-options').trigger('click')
    await vi.waitFor(() => expect(document.body.textContent).toContain('Open the board'))
    const item = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(e => e.textContent?.includes('Open the board'))!
    item.click()
    await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith({ path: '/board', query: { machine: '' } }))
  })

  it('every machine\'s menu opens its board, filtered on it', async () => {
    const w = await mountHome()
    navigate.mockClear()
    await w.findAll('.machine-options')[1]!.trigger('click')
    await vi.waitFor(() => expect(document.body.textContent).toContain('Open the board'))
    const item = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(e => e.textContent?.includes('Open the board'))!
    item.click()
    await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith({ path: '/board', query: { machine: 'laptop' } }))
  })
})

describe('Settings › Machine bar', () => {
  beforeEach(() => { reset(); setState() })
  afterEach(() => { herdrState.value = { ok: false, workspaces: [], panes: [] }; reset() })

  it('lists All and every machine, a checkbox takes one off the bar', async () => {
    const w = track(await mountSuspended(MachineBarSettings))
    const rows = w.findAll('.bar-pref-row')
    expect(rows.map(r => r.find('.bar-pref-label span').text())).toEqual(['All', 'Server', 'Laptop', 'Devbox'])
    expect(rows.every(r => (r.find('input[type="checkbox"]').element as HTMLInputElement).checked)).toBe(true)
    await rows[2]!.find('input[type="checkbox"]').setValue(false)
    expect(machineBarHidden.value).toEqual(['laptop'])
    expect(localStorage.getItem('machineBarHidden')).toBe('["laptop"]')
    expect(w.findAll('.bar-pref-row')[2]!.classes()).toContain('off')
  })

  it('arrow keys on the handle move an item, Reset puts everything back', async () => {
    const w = track(await mountSuspended(MachineBarSettings))
    await w.findAll('.bar-pref-grip')[0]!.trigger('keydown', { key: 'ArrowDown' })
    expect(machineBarOrder.value).toEqual(['', BAR_ALL, 'laptop', 'devbox'])
    await w.findAll('.bar-pref-grip')[3]!.trigger('keydown', { key: 'ArrowUp' })
    expect(machineBarOrder.value).toEqual(['', BAR_ALL, 'devbox', 'laptop'])
    expect(w.findAll('.bar-pref-row').map(r => r.attributes('data-bar-id'))).toEqual(['', BAR_ALL, 'devbox', 'laptop'])
    machineBarHidden.value = ['devbox']
    machineBarSaved.value = 'laptop'
    await nextTick()
    await w.find('.bar-pref-reset').trigger('click')
    expect(machineBarOrder.value).toEqual([])
    expect(machineBarHidden.value).toEqual([])
    expect(machineBarSaved.value).toBe(BAR_ALL)
  })

  it('a single machine: All and that machine', async () => {
    herdrState.value = { ok: true, workspaces: [], panes: [] } as never
    const w = track(await mountSuspended(MachineBarSettings))
    expect(w.findAll('.bar-pref-row').map(r => r.attributes('data-bar-id'))).toEqual([BAR_ALL, ''])
    expect(w.findAll('.bar-pref-label span').map(r => r.text())).toEqual(['All', 'herdr'])
    expect(w.find('.bar-pref-state').classes()).toContain('online')
  })

  it('turned off, the list goes', async () => {
    const w = track(await mountSuspended(MachineBarSettings))
    machineBarOn.value = false
    await nextTick()
    expect(w.find('.bar-pref-list').exists()).toBe(false)
    expect(localStorage.getItem('machineBar')).toBe('0')
  })
})
