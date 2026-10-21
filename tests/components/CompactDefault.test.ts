import { afterEach, expect, it, vi } from 'vitest'
import { mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import { nextTick, type ComponentPublicInstance } from 'vue'
import type { Pane } from '#shared/types'

registerEndpoint('/api/quotas', () => ({ claude: null, codex: null }))
registerEndpoint('/api/machine/order', () => ({ order: [] }))
registerEndpoint('/api/machine/awake', () => ({ supported: false }))
const pane: Pane = { id: 'w1:p1', workspace: 'w1', tab: 'w1:t1', tabLabel: null, agent: 'claude', name: null, label: null, status: 'idle', title: 'Sample agent', cwd: '/tmp/demo', agentSession: null }
const pass = { template: '<div><slot /></div>' }

async function freshApp() {
  vi.resetModules()
  const state = await import('~/composables/useHerdr')
  state.herdrState.value = { ok: true, panes: [pane], workspaces: [{ id: 'w1', number: 1, label: 'Sample', status: null, worktree: false }] }
  state.eventsOpen.value = true
  const Home = (await import('~/components/HomeView.vue')).default
  const Settings = (await import('~/components/SettingsView.vue')).default
  return { state, Home, Settings }
}

// Observe cards at mount and on updates, including inside their context-menu wrapper.
async function mountHome(Home: Awaited<ReturnType<typeof freshApp>>['Home']) {
  const seen: boolean[] = []
  function record(this: ComponentPublicInstance) {
    if (!(this.$el instanceof Element)) return
    const cards = [...this.$el.querySelectorAll('.card')]
    if (this.$el.matches('.card')) cards.push(this.$el)
    for (const card of cards) seen.push(card.classList.contains('compact'))
  }
  const w = await mountSuspended(Home, { global: {
    stubs: { UContextMenu: pass, UTooltip: pass },
    mixins: [{ mounted: record, updated: record }],
  } })
  try {
    expect(w.findAll('.card').length).toBeGreaterThan(0)
    expect(seen.length).toBeGreaterThan(0)
    expect(seen.every(Boolean)).toBe(true)
    expect(w.find('.card.compact').isVisible()).toBe(true)
    expect(w.findAll('.card:not(.compact)')).toHaveLength(0)
    return w
  } catch (error) {
    w.unmount()
    throw error
  }
}
afterEach(() => { localStorage.removeItem('compactList') })

it('empty storage: the list is compact from its first card without saving a preference', async () => {
  localStorage.removeItem('compactList')
  const { state, Home } = await freshApp()
  const w = await mountHome(Home)
  try {
    expect(w.classes()).toContain('list-compact')
    expect(localStorage.getItem('compactList')).toBeNull()
  } finally { w.unmount(); state.eventsOpen.value = false }
})

it('turning Compact list off persists across a fresh app and settings mount', async () => {
  localStorage.removeItem('compactList')
  const first = await freshApp()
  first.state.desk.value = true
  const settings = await mountSuspended(first.Settings, { route: '/settings?section=appearance' })
  const toggle = settings.findAll('.settings-toggle').find(w => w.text().includes('Compact list'))!.find('[role="switch"]')
  try {
    expect(toggle.attributes('aria-checked')).toBe('true')
    await toggle.trigger('click')
    expect(toggle.attributes('aria-checked')).toBe('false')
    await nextTick()
    expect(localStorage.getItem('compactList')).toBe('0')
  } finally { settings.unmount(); first.state.eventsOpen.value = false }
  const second = await freshApp()
  const home = await mountHome(second.Home)
  try {
    expect(home.classes()).not.toContain('list-compact')
    expect(home.findAll('.card-main')).toHaveLength(0)
  } finally { home.unmount(); second.state.eventsOpen.value = false }
  second.state.desk.value = true
  const restored = await mountSuspended(second.Settings, { route: '/settings?section=appearance' })
  try {
    expect(restored.findAll('.settings-toggle').find(w => w.text().includes('Compact list'))!.find('[role="switch"]').attributes('aria-checked')).toBe('false')
  } finally { restored.unmount() }
})
