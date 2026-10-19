import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import BoardPanel from '~/components/BoardPanel.vue'
import { herdrState } from '~/composables/useHerdr'
import type { Pane } from '#shared/types'

// What `coordinator status` says now, and how many times it was asked.
let status: { pane: string | null, state: string } = { pane: 'w1:p1', state: 'idle' }
let asked = 0
// When set, each lookup waits until the test answers it, in the order it picks.
let holding = false
const waiting: Array<(r: { pane: string | null, state: string }) => void> = []
registerEndpoint('/api/tasks/coordinator', () => {
  asked++
  return holding ? new Promise(resolve => waiting.push(resolve)) : status
})

const pane = (id: string): Pane => ({ id, workspace: id.split(':')[0]!, tab: `${id.split(':')[0]}:t1`, tabLabel: null, agent: 'claude', name: null, label: null, status: 'idle', title: null, cwd: '/tmp/demo', agentSession: null })
const setPanes = (ids: string[]) => { herdrState.value = { ok: true, workspaces: [], panes: ids.map(pane) } }

type To = { kind: 'main' } | { kind: 'machine' } | { kind: 'project', repo: string }
async function panel(reachable = true, to: To = { kind: 'main' }) {
  const w = await mountSuspended(BoardPanel, {
    props: { target: { machine: '', kind: 'coordinator', to }, task: null, machineLabel: 'Local', reachable },
    global: { stubs: { AgentView: true, FoldText: true } },
  })
  await flushPromises()
  return { w, vm: w.vm as unknown as { coordShown: string | null } }
}

describe('the Board panel follows its coordinator', () => {
  afterEach(() => { vi.useRealTimers(); holding = false; waiting.length = 0; herdrState.value = { ok: false, workspaces: [], panes: [] }; status = { pane: 'w1:p1', state: 'idle' }; asked = 0 })

  it('a coordinator restarted in a new pane is shown without closing the panel', async () => {
    setPanes(['w1:p1'])
    const { w, vm } = await panel()
    expect(vm.coordShown).toBe('w1:p1')
    vi.useFakeTimers()
    // Its pane closes, and Herdr starts it again in another one.
    status = { pane: 'w2:p1', state: 'idle' }
    setPanes(['w2:p1'])
    await flushPromises()
    await vi.advanceTimersByTimeAsync(1000)
    await flushPromises()
    expect(vm.coordShown).toBe('w2:p1')
    w.unmount()
  })

  it('a coordinator started from Herdr while none was there shows up', async () => {
    status = { pane: null, state: 'none' }
    setPanes(['w5:p1'])
    const { w, vm } = await panel()
    expect(vm.coordShown).toBeNull()
    vi.useFakeTimers()
    status = { pane: 'w3:p1', state: 'idle' }
    setPanes(['w5:p1', 'w3:p1'])
    await flushPromises()
    await vi.advanceTimersByTimeAsync(1000)
    await flushPromises()
    expect(vm.coordShown).toBe('w3:p1')
    w.unmount()
  })

  it('asks again when its machine is back', async () => {
    status = { pane: null, state: 'none' }
    setPanes([])
    const { w } = await panel(false)
    const before = asked
    status = { pane: 'w1:p1', state: 'idle' }
    await w.setProps({ reachable: true })
    await flushPromises()
    expect(asked).toBe(before + 1)
    w.unmount()
  })

  it('a shown coordinator is not asked again while Herdr keeps its pane', async () => {
    setPanes(['w1:p1'])
    const { w } = await panel()
    const before = asked
    vi.useFakeTimers()
    setPanes(['w1:p1', 'w4:p1'])
    await flushPromises()
    await vi.advanceTimersByTimeAsync(5000)
    expect(asked).toBe(before)
    w.unmount()
  })

  for (const to of [{ kind: 'main' }, { kind: 'machine' }, { kind: 'project', repo: 'demo' }] as To[]) {
    it(`two lookups answered in reverse order keep the latest answer (${to.kind})`, async () => {
      setPanes(['w3:p1'])
      holding = true
      // The first lookup, from opening, is still out when its machine is back.
      const { w, vm } = await panel(false, to)
      await w.setProps({ reachable: true })
      await flushPromises()
      expect(waiting).toHaveLength(2)
      const [first, second] = waiting
      second!({ pane: 'w3:p1', state: 'idle' })
      await vi.waitFor(() => expect(vm.coordShown).toBe('w3:p1'))
      first!({ pane: null, state: 'none' })
      // Time for the earlier answer to arrive and be dropped.
      for (let i = 0; i < 10; i++) await flushPromises()
      await new Promise(r => setTimeout(r, 100))
      expect(vm.coordShown).toBe('w3:p1')
      w.unmount()
    })
  }

  it('an earlier lookup\'s "starting" answer schedules no retry', async () => {
    setPanes(['w3:p1'])
    holding = true
    const { w, vm } = await panel(false)
    await w.setProps({ reachable: true })
    await flushPromises()
    const [first, second] = waiting
    second!({ pane: 'w3:p1', state: 'idle' })
    await vi.waitFor(() => expect(vm.coordShown).toBe('w3:p1'))
    const before = asked
    first!({ pane: null, state: 'starting' })
    await new Promise(r => setTimeout(r, 3300))
    expect(asked).toBe(before)
    expect(vm.coordShown).toBe('w3:p1')
    w.unmount()
  })
})
