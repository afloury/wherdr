// WHR-394: a machine's "…" button opened an empty menu unless a Claude quota
// suggestion applied. It now always carries the actions herdr-core can do.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { mockNuxtImport, mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import HomeView from '~/components/HomeView.vue'
import { eventsOpen, herdrState, homeGrouping } from '~/composables/useHerdr'
import { newAgentMachine, newAgentOpen } from '~/composables/useUi'
import type { MachineInfo, Pane } from '#shared/types'

const { navigate } = vi.hoisted(() => ({ navigate: vi.fn() }))
mockNuxtImport('navigateTo', () => navigate)
const connect = vi.fn(() => ({ ok: true }))
registerEndpoint('/api/machine/connect', { method: 'POST', handler: connect })

const machine = (key: string, label: string, status: MachineInfo['status'] = 'online'): MachineInfo =>
  ({ key, label, local: key === '', status, error: null, session: 'default' })
const pane = (id: string, m: string): Pane => ({
  id, workspace: id.split(':')[0]!, tab: `${id.split(':')[0]}:t1`, tabLabel: null, agent: 'claude', name: null, label: null,
  status: 'idle', title: `Agent ${id}`, cwd: '/tmp/demo', agentSession: null, machine: m,
})
// The dropdown renders its items inline so the test can read and pick them.
type Item = { label: string, onSelect: () => void }
const Dropdown = defineComponent({
  props: { items: { type: Array, default: () => [] } },
  setup: (props, { slots }) => () => h('div', { class: 'dd' }, [slots.default?.(), ...(props.items as Item[][]).flat().map(i =>
    h('button', { class: 'dd-item', onClick: () => i.onSelect() }, i.label))]),
})
const pass = { template: '<div><slot /></div>' }
const mountHome = () => mountSuspended(HomeView, { global: { stubs: { UDropdownMenu: Dropdown, UContextMenu: pass, UTooltip: pass } } })
const menuOf = (w: Awaited<ReturnType<typeof mountHome>>, key: string) => w.find(`section.machine[data-machine="${key}"] .machine-row .dd`)

describe('machine header menu', () => {
  beforeEach(() => {
    homeGrouping.value = 'machine'
    const panes = [pane('dell/w1:p1', 'dell')]
    herdrState.value = { ok: true, panes, machines: [machine('', 'Local'), machine('dell', 'Dell'), machine('vps', 'Vps', 'offline')],
      workspaces: panes.map((p, i) => ({ id: p.workspace, number: i + 1, label: `s${i}`, focused: false, machine: p.machine })) } as never
    eventsOpen.value = true
  })
  afterEach(() => {
    herdrState.value = { ok: false, workspaces: [], panes: [] }
    eventsOpen.value = false
    newAgentOpen.value = false
    newAgentMachine.value = null
    navigate.mockClear()
  })

  it('a machine with no agents gets actions, and New agent here preselects it', async () => {
    const w = await mountHome()
    const local = menuOf(w, 'local')
    expect(local.findAll('.dd-item').map(b => b.text())).toEqual(['New agent here', 'Machine settings'])
    await local.findAll('.dd-item')[0]!.trigger('click')
    expect(newAgentOpen.value).toBe(true)
    expect(newAgentMachine.value).toBe('')
    await menuOf(w, 'dell').findAll('.dd-item')[1]!.trigger('click')
    expect(navigate).toHaveBeenCalledWith({ path: '/settings', query: { section: 'agents' } })
    w.unmount()
  })

  it('an offline core machine offers Reconnect instead of New agent', async () => {
    const w = await mountHome()
    const vps = menuOf(w, 'vps')
    expect(vps.findAll('.dd-item').map(b => b.text())).toEqual(['Reconnect', 'Machine settings'])
    await vps.findAll('.dd-item')[0]!.trigger('click')
    await new Promise(r => setTimeout(r, 20))
    expect(connect).toHaveBeenCalled()
    w.unmount()
  })
})
