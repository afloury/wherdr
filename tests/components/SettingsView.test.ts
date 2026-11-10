// SettingsView sections, in one file: each component test file pays the first
// mount of the Nuxt app again.
import { afterEach, expect, it, vi } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { nextTick } from 'vue'
import { useRouter } from '#app'
import SettingsView from '~/components/SettingsView.vue'
import ShortcutsSheet from '~/components/ShortcutsSheet.vue'
import ShortcutsReference from '~/components/ShortcutsReference.vue'
import { coarse, defaultViewMode, desk, encryptedText, reducedMotion, sidePanelRoom, smoothTouchScrolling, typewriterSpeed } from '~/composables/useHerdr'

const global = { stubs: { UTooltip: { template: '<span><slot /></span>' } } }
const original = {
  desk: desk.value, coarse: coarse.value, mode: defaultViewMode.value, smooth: smoothTouchScrolling.value,
  encrypted: encryptedText.value, motion: reducedMotion.value, speed: typewriterSpeed.value,
}
afterEach(async () => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  desk.value = original.desk
  sidePanelRoom.value = false
  coarse.value = original.coarse
  defaultViewMode.value = original.mode
  encryptedText.value = original.encrypted
  reducedMotion.value = original.motion
  typewriterSpeed.value = original.speed
  smoothTouchScrolling.value = original.smooth
  await nextTick()
  localStorage.removeItem('smoothTouchScrolling')
})

for (const device of ['desktop', 'phone', 'tablet']) {
  it(`offers the shared pane preference in Conversation on ${device}`, async () => {
    desk.value = device !== 'phone'
    coarse.value = device !== 'desktop'
    defaultViewMode.value = 'chat'
    const router = useRouter()
    if (device === 'phone') {
      // Exercise a direct entry: Settings inserts Home underneath on mount.
      history.replaceState({ ...history.state, back: null }, '')
    }
    // Desktop enters through the former Desktop query, which redirects to Conversation.
    const w = await mountSuspended(SettingsView, { route: `/settings?section=${device === 'desktop' ? 'desktop' : 'conversation'}`, global })
    try {
      if (device === 'desktop') {
        // The desktop layout can render a fallback before the redirect finishes.
        await vi.waitFor(() => expect(router.currentRoute.value.fullPath).toBe('/settings?section=conversation'))
        await vi.waitFor(() => expect(w.findAll('.settings-group').find(g => g.text().includes('Default pane view'))!.isVisible()).toBe(true))
      }
      if (device === 'phone') {
        // mountSuspended does not await async onMounted hooks. Wait for both
        // replace('/') and push(here) before assertions or tearing down the DOM.
        await vi.waitFor(() => {
          expect(router.currentRoute.value.fullPath).toBe('/settings?section=conversation')
          expect(history.state.back).toBe('/')
        })
      }
      const group = w.findAll('.settings-group').find(g => g.text().includes('Default pane view'))!
      expect(group.isVisible()).toBe(true)
      await group.findAll('[role="radio"]')[1]!.trigger('click')
      expect(defaultViewMode.value).toBe('term')
      const nav = w.get('.settings-nav')
      expect(nav.text()).not.toContain('Desktop')
      expect(nav.text().includes('Shortcuts')).toBe(device === 'desktop')
    } finally { w.unmount() }
  })
}

it('shows the same reference component in Settings and the shortcut sheet', async () => {
  desk.value = true
  coarse.value = false
  const w = await mountSuspended(SettingsView, { route: '/settings?section=shortcuts', global })
  const sheet = await mountSuspended(ShortcutsSheet, { global: { stubs: { AppSheet: { template: '<div><slot /></div>' } } } })
  try {
    expect(w.getComponent(ShortcutsReference).isVisible()).toBe(true)
    expect(w.getComponent(ShortcutsReference).findAll('.shortcut-row')).toHaveLength(17)
    expect(sheet.findComponent(ShortcutsReference).exists()).toBe(true)
  } finally { w.unmount(); sheet.unmount() }
})

it('Terminal: smooth touch scrolling defaults to off and the switch persists across remounts', async () => {
  expect(smoothTouchScrolling.value).toBe(false)
  const mount = () => mountSuspended(SettingsView, { route: '/settings?section=terminal', global })
  let w = await mount()
  const row = () => w.findAll('.settings-toggle').find(r => r.text().includes('Smooth touch scrolling (beta)'))!
  try {
    expect(row().text()).toContain('Experimental')
    expect(row().get('[role="switch"]').attributes('aria-checked')).toBe('false')
    await row().get('[role="switch"]').trigger('click')
    expect(localStorage.getItem('smoothTouchScrolling')).toBe('1')
    w.unmount()
    w = await mount()
    expect(row().get('[role="switch"]').attributes('aria-checked')).toBe('true')
    await row().get('[role="switch"]').trigger('click')
    expect(localStorage.getItem('smoothTouchScrolling')).toBe('0')
  } finally { w.unmount() }
})

it('Conversation: replays the encrypted preview from glyphs to the complete plain reply when enabled', async () => {
  desk.value = true
  reducedMotion.value = false
  typewriterSpeed.value = 'slow'
  encryptedText.value = true
  // Control animation frames without faking the timers Nuxt needs to mount.
  let frame: FrameRequestCallback | undefined
  let now = Date.now()
  vi.spyOn(Date, 'now').mockImplementation(() => now)
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { frame = cb; return 1 })
  vi.stubGlobal('cancelAnimationFrame', () => { frame = undefined })
  const w = await mountSuspended(SettingsView, { route: '/settings?section=conversation', global })
  try {
    const toggle = w.find('.encrypted-toggle [role="switch"]')
    expect(toggle.attributes('aria-checked')).toBe('true')
    // Finish the initial preview so this check requires the setting to replay it.
    now += 30_000
    frame?.(now)
    await nextTick()
    now += 1
    await toggle.trigger('click')
    expect(toggle.attributes('aria-checked')).toBe('false')
    now += 1
    await toggle.trigger('click')
    expect(toggle.attributes('aria-checked')).toBe('true')
    now += 1000
    frame?.(now)
    await nextTick()
    const preview = w.find('.typing-sample')
    const glyphs = preview.findAll('.tw-trail [data-g]')
    expect(glyphs.length).toBeGreaterThan(0)
    expect(glyphs[0]!.attributes('data-g')).toMatch(/^\S$/u)
    now += 30_000
    frame?.(now)
    await nextTick()
    expect(preview.findAll('.tw-trail [data-g]')).toHaveLength(0)
    expect(preview.text()).toContain('Found the cause: the cache was never invalidated after an update.')
    expect(preview.text()).toContain('All tests pass.')
  } finally { w.unmount() }
})

it('Machines has its own section; Agents holds Pace, which ?section=pacing still opens', async () => {
  desk.value = true
  coarse.value = false
  const w = await mountSuspended(SettingsView, { route: '/settings?section=pacing', global })
  try {
    const nav = w.get('.settings-nav').findAll('.settings-nav-item').map(b => b.text())
    expect(nav.slice(nav.indexOf('Agents'), nav.indexOf('Agents') + 2)).toEqual(['Agents', 'Machines'])
    expect(nav).not.toContain('Pace')
    const agents = w.findAll('.settings-section').find(s => s.find('[data-testid="offered-agents"]').exists())!
    const shown = (el: { element: Element }) => (el.element as HTMLElement).style.display !== 'none'
    expect(shown(agents)).toBe(true)
    expect(agents.get('#settings-pace').text()).toContain('Pace')
    expect(agents.find('.core-machines').exists()).toBe(false)
    const machines = w.get('[data-testid="settings-machines"]')
    expect(shown(machines)).toBe(false)
    await useRouter().replace('/settings?section=machines')
    await vi.waitFor(() => expect(shown(machines)).toBe(true))
    expect(machines.find('.core-machines').exists()).toBe(true)
    expect(shown(agents)).toBe(false)
  } finally { w.unmount() }
})

it('Wide computer: Settings open beside the conversation, on the linked section, and close', async () => {
  desk.value = true
  coarse.value = false
  sidePanelRoom.value = true
  const router = useRouter()
  const w = await mountSuspended(SettingsView, { props: { panel: true }, route: '/a/w1:p1', global })
  const path = () => router.currentRoute.value.fullPath
  const shown = (el: { element: Element }) => (el.element as HTMLElement).style.display !== 'none'
  try {
    // A link to a section, from the conversation: the panel opens on it, the conversation stays.
    await router.push('/settings?section=pacing')
    await vi.waitFor(() => expect(path()).toBe('/a/w1:p1?section=pacing'))
    const agents = w.findAll('.settings-section').find(s => s.find('#settings-pace').exists())!
    await vi.waitFor(() => expect(shown(agents)).toBe(true))
    expect(w.get('#settings').classes()).toContain('settings-panel')
    // Another section stays in the panel.
    await w.findAll('.settings-nav-item').find(b => b.attributes('title') === 'Terminal')!.trigger('click')
    await vi.waitFor(() => expect(path()).toBe('/a/w1:p1?section=terminal'))
    // Escape closes it first, before the conversation's own Escape (Stop on a working agent,
    // registered earlier); the listener sits nearer the target so it would run first otherwise.
    let conversationGotEscape = false
    const stop = (e: KeyboardEvent) => { conversationGotEscape = true; e.preventDefault() }
    document.body.addEventListener('keydown', stop)
    try {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      await vi.waitFor(() => expect(path()).toBe('/a/w1:p1'))
      expect(conversationGotEscape).toBe(false)
    } finally { document.body.removeEventListener('keydown', stop) }
    // The gear (a plain /settings) opens it again; the close button closes it.
    await router.push('/settings')
    await vi.waitFor(() => expect(path()).toBe('/a/w1:p1?section=appearance'))
    await w.get('button[aria-label="Close settings"]').trigger('click')
    await vi.waitFor(() => expect(path()).toBe('/a/w1:p1'))
    // "Open full page" keeps today's page.
    await router.push('/settings?section=about')
    await vi.waitFor(() => expect(path()).toBe('/a/w1:p1?section=about'))
    await w.get('button[aria-label="Open full page"]').trigger('click')
    await vi.waitFor(() => expect(path()).toBe('/settings?section=about'))
  } finally { w.unmount() }
})

it('Conversation: tabs split Display, Dictation and Read aloud, the tab kept in the URL', async () => {
  desk.value = true
  coarse.value = false
  const router = useRouter()
  const w = await mountSuspended(SettingsView, { route: '/settings?section=conversation&tab=dictation', global })
  try {
    const shown = (sel: string) => (w.get(sel).element as HTMLElement).style.display !== 'none'
    const panels = () => ['#conversation-panel-display', '#conversation-panel-dictation', '#conversation-panel-read-aloud'].filter(shown)
    const tabs = () => w.findAll('[role="tab"]').filter(b => b.attributes('id')?.startsWith('conversation-tab-'))
    expect(tabs().map(b => b.text())).toEqual(['Display', 'Dictation', 'Read aloud'])
    expect(panels()).toEqual(['#conversation-panel-dictation'])
    expect(tabs()[1]!.attributes('aria-selected')).toBe('true')
    await tabs()[2]!.trigger('click')
    await vi.waitFor(() => expect(router.currentRoute.value.fullPath).toBe('/settings?section=conversation&tab=read-aloud'))
    await vi.waitFor(() => expect(panels()).toEqual(['#conversation-panel-read-aloud']))
    // No tab, or an unknown one: Display.
    await router.replace('/settings?section=conversation&tab=nope')
    await vi.waitFor(() => expect(panels()).toEqual(['#conversation-panel-display']))
    expect(w.get('#conversation-panel-display').text()).toContain('Default pane view')
  } finally { w.unmount() }
})

it('points at a target: opens its tab, highlights it until a click, and says so politely', async () => {
  desk.value = true
  coarse.value = false
  const w = await mountSuspended(SettingsView, { route: '/settings?section=conversation&tab=display&target=conversation.reply-style', global })
  try {
    const el = w.get('[data-ui-target="conversation.reply-style"]')
    await vi.waitFor(() => expect(el.classes()).toContain('ui-halo'))
    expect(el.attributes('aria-describedby')).toBe('ui-target-note')
    expect(w.get('#ui-target-note').text()).toBe('Pointing to Reply style')
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    expect(el.classes()).not.toContain('ui-halo')
  } finally { w.unmount() }
})
