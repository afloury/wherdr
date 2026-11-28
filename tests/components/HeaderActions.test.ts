import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import HomeView from '~/components/HomeView.vue'
import AgentView from '~/components/AgentView.vue'
import { curPane, desk, herdrState } from '~/composables/useHerdr'
import { homeListReady } from '~/composables/useHomeLoad'
import { createAppPluginDeps } from '~/composables/useClientPlugins'
import type { Pane } from '#shared/types'

const pane: Pane = { id: 'w1:p7', workspace: 'w1', tab: 'w1:t1', tabLabel: null, agent: 'claude', name: null, label: null, status: 'idle', title: null, cwd: '/home/user/demo', agentSession: null }
registerEndpoint('/api/chat', () => ({ available: true, token: 't', file: '/home/user/demo/t.jsonl', start: 0, items: [] }))
registerEndpoint('/api/prompt', { method: 'POST', handler: () => ({ ok: true }) })
registerEndpoint('/api/client-plugins', () => ({ plugins: [], enabled: false }))

const pass = { template: '<div><slot /></div>' }
// Captures every constructed ResizeObserver's callback by element; fire(el, width) triggers one.
function stubResizeObservers() {
  const callbacks = new Map<Element, ResizeObserverCallback>()
  vi.stubGlobal('ResizeObserver', class {
    constructor(private cb: ResizeObserverCallback) {}
    observe(el: Element) { callbacks.set(el, this.cb) }
    unobserve(el: Element) { callbacks.delete(el) }
    disconnect() {}
  })
  return (el: Element, width: number) => callbacks.get(el)?.([{ target: el, contentRect: { width } }] as never, {} as never)
}

describe('header-actions marker in the real headers', () => {
  beforeEach(() => {
    homeListReady.value = true
    herdrState.value = { ok: true, workspaces: [{ id: 'w1', number: 1, label: 'Demo', focused: false }], panes: [pane] } as never
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    curPane.value = null
    desk.value = false
    herdrState.value = { ok: false, workspaces: [], panes: [] }
  })

  it('both headers carry an empty first-child marker, fold around a wide widget and tear it down on unmount', async () => {
    const fire = stubResizeObservers()

    const hw = await mountSuspended(HomeView, { global: { stubs: { UContextMenu: pass, UTooltip: pass } } })
    const homeSlot = hw.find('.home-actions > [data-wherdr="header-actions"]')
    expect(homeSlot.exists()).toBe(true)
    expect(homeSlot.element.children).toHaveLength(0)
    expect(hw.find('.home-actions').element.firstElementChild).toBe(homeSlot.element)
    fire(hw.find('.home-title-row').element, 358)
    await nextTick()
    expect(hw.find('.home-actions .space-menu').exists()).toBe(false)
    homeSlot.element.append(document.createElement('button'))
    fire(homeSlot.element, 130)
    await nextTick()
    expect(hw.find('.home-actions .space-menu').exists()).toBe(true)
    hw.unmount()

    desk.value = true
    const aw = await mountSuspended(AgentView, { props: { paneId: pane.id }, route: `/a/${pane.id}`, attachTo: document.body, global: { stubs: { UTooltip: pass } } })
    const agentSlot = aw.find('.agent-actions > [data-wherdr="header-actions"]')
    expect(agentSlot.exists()).toBe(true)
    expect(agentSlot.element.children).toHaveLength(0)
    expect(aw.find('.agent-actions').element.firstElementChild).toBe(agentSlot.element)
    fire(aw.find('.agent-top').element, 600)
    await nextTick()
    expect(aw.find('[data-testid="agent-notes"]').exists()).toBe(true)
    agentSlot.element.append(document.createElement('button'))
    fire(agentSlot.element, 80)
    await nextTick()
    expect(aw.find('[data-testid="agent-notes"]').exists()).toBe(false)

    // The app wiring mounts into the real slot; the widget's cleanup runs when the view goes.
    let cleaned = 0
    const dispose = createAppPluginDeps(() => {}).mountHeaderAction(() => () => { cleaned++ })
    expect(agentSlot.element.querySelector('.header-action')).not.toBeNull()
    aw.unmount()
    await vi.waitFor(() => expect(cleaned).toBe(1))
    dispose()
  })
})
