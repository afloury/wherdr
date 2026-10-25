import { afterEach, describe, expect, it } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import NotificationRules from '~/components/NotificationRules.vue'
import SettingsView from '~/components/SettingsView.vue'
import { desk, herdrState } from '~/composables/useHerdr'
import { notificationClock, notificationRules } from '~/composables/useNotificationRules'
import { LEVEL_EVENTS, defaultNotifications, type NotificationException, type NotificationSettings } from '#shared/notificationRules'
import type { Pane } from '#shared/types'

const pane = (id: string, p: Partial<Pane> = {}): Pane => ({ id, workspace: id.split(':')[0]!, tab: `${id.split(':')[0]}:t1`, tabLabel: null, agent: 'claude', name: null, label: null, status: 'idle', title: null, cwd: '/tmp/demo', agentSession: null, ...p })
registerEndpoint('/api/tasks/links', () => ({ version: 'example', machines: [{ machine: '', repos: [],
  coordinators: [
    { level: 'project', repo: 'shop', session: 'default', pane: 'w1:p2', workspace: 'w1' },
    { level: 'top', session: 'default', pane: 'w1:p1', workspace: 'w1' },
  ],
  tasks: [{ id: 'shop/1', repo: 'shop', n: 1, key: 'SHOP-1', title: 'Task', panes: [{ id: 'w2:p1', role: 'worker' }], workspace: 'w2', stage: 'working', progress: null, msg: '', since: null }],
}] }))

const MAIN = 'default/top/'
const exception = (id: string, opts: Partial<NotificationException> = {}): NotificationException =>
  ({ kind: 'coordinator', machine: '', id, label: 'Example', events: [...LEVEL_EVENTS.finished], subagents: false, until: null, ...opts })
const policy = (events: NotificationSettings['default']['events'], ...exceptions: NotificationException[]): NotificationSettings =>
  ({ version: 2, default: { events, subagents: false }, exceptions })

async function mount(settings: NotificationSettings) {
  notificationRules.value = settings
  notificationClock.value = Date.now()
  herdrState.value = { ok: true, workspaces: [], panes: [
    pane('w1:p1', { title: 'Coordinator' }), pane('w1:p2', { title: 'Shop coordinator' }),
    pane('w2:p1', { title: 'Task worker' }), pane('w3:p1', { title: 'Standalone agent' }),
  ] }
  const w = await mountSuspended(NotificationRules)
  await flushPromises()
  return w
}
afterEach(() => {
  notificationRules.value = defaultNotifications()
  herdrState.value = { ok: false, workspaces: [], panes: [] }
})

describe('notification settings: a default and exceptions', () => {
  it('sets the default level and the Sub-agents switch', async () => {
    const w = await mount(policy([]))
    const level = w.find('[data-testid="notification-default"] select')
    expect((level.element as HTMLSelectElement).value).toBe('muted')
    await level.setValue('all')
    expect(notificationRules.value.default.events).toEqual(LEVEL_EVENTS.all)
    await w.find('[data-testid="notification-default"] [role="switch"]').trigger('click')
    expect(notificationRules.value.default.subagents).toBe(true)
    w.unmount()
  })

  it('adds an exception for a coordinator or a standalone agent, never a task agent', async () => {
    const w = await mount(policy([]))
    await w.find('.notification-add').trigger('click')
    const picker = w.find('[data-testid="notification-picker"]')
    expect(picker.text()).toContain('Coordinator')
    expect(picker.text()).toContain('shop coordinator')
    expect(picker.text()).toContain('Standalone agent')
    expect(picker.text()).not.toContain('Task worker')
    await picker.findAll('button').find(b => b.text() === 'Coordinator')!.trigger('click')
    // Default Muted: the new exception starts at "Needs you + finished".
    expect(notificationRules.value.exceptions).toEqual([expect.objectContaining({ kind: 'coordinator', id: MAIN, events: LEVEL_EVENTS.finished })])
    const card = w.find('[data-testid="notification-exception"]')
    expect(card.text()).toContain('Louder than the default (Muted)')
    w.unmount()
  })

  it('shows a quieter exception, removes it back to the default, and removes all', async () => {
    const w = await mount(policy(LEVEL_EVENTS.all, exception('default/project/shop', { events: [] })))
    const card = w.find('[data-testid="notification-exception"]')
    expect(card.text()).toContain('Quieter than the default (All activity)')
    expect(card.text()).toContain('Back to the default: All activity')
    await card.find('.settings-action').trigger('click')
    expect(notificationRules.value.exceptions).toEqual([])
    notificationRules.value = policy([], exception(MAIN), exception('default/project/shop'))
    await flushPromises()
    await w.find('.notification-reset').trigger('click')
    expect(notificationRules.value.exceptions).toEqual([])
    w.unmount()
  })

  it('after a timed mute ends, the coordinator can be added again and the old record goes', async () => {
    const w = await mount(policy([], exception(MAIN, { events: null, until: Date.now() - 1000 })))
    expect(w.findAll('[data-testid="notification-exception"]')).toHaveLength(0)
    await w.find('.notification-add').trigger('click')
    const main = w.find('[data-testid="notification-picker"]').findAll('button').find(b => b.text() === 'Coordinator')
    expect(main).toBeTruthy()
    await main!.trigger('click')
    expect(notificationRules.value.exceptions).toEqual([expect.objectContaining({ id: MAIN, events: LEVEL_EVENTS.finished, until: null })])
    w.unmount()
  })

  it('a migrated rule on a task agent is neither shown nor kept', async () => {
    const w = await mount(policy([], { ...exception('w2:p1', { events: ['message'] }), kind: 'conversation', label: 'Task worker' }))
    expect(w.findAll('[data-testid="notification-exception"]')).toHaveLength(0)
    await flushPromises()
    expect(notificationRules.value.exceptions).toEqual([])
    w.unmount()
  })

  it('sorts exceptions by machine then name, not muted first', async () => {
    const w = await mount(policy([], exception('default/project/shop', { events: [] }), { ...exception('w3:p1'), kind: 'conversation', label: 'Standalone agent' }, exception(MAIN)))
    const names = w.findAll('[data-testid="notification-exception"] .notification-rule-head b').map(b => b.text())
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)))
    expect(names).toHaveLength(3)
    w.unmount()
  })

  it('an exception has its own level, Customize and Sub-agents switch', async () => {
    const w = await mount(policy([], exception(MAIN)))
    const card = w.find('[data-testid="notification-exception"]')
    await card.find('select').setValue('needs-you')
    expect(notificationRules.value.exceptions[0]!.events).toEqual(['needs-you'])
    const message = card.findAll('input[type="checkbox"]').find(i => i.element.parentElement!.textContent!.includes('New message'))!
    await message.setValue(true)
    expect(notificationRules.value.exceptions[0]!.events).toEqual(['needs-you', 'message'])
    expect((card.find('select').element as HTMLSelectElement).value).toBe('custom')
    await card.find('[role="switch"]').trigger('click')
    expect(notificationRules.value.exceptions[0]!.subagents).toBe(true)
    w.unmount()
  })
})

it('orders the Notifications section: Do not disturb, default, exceptions, this device', async () => {
  // Computer layout: on a phone, Settings re-routes after mounting (history), past the test's end.
  const wasDesk = desk.value
  desk.value = true
  const w = await mountSuspended(SettingsView, { route: '/settings?section=notifications', global: { stubs: { UTooltip: { template: '<span><slot /></span>' } } } })
  const html = w.html()
  const at = (id: string) => html.indexOf(`data-testid="${id}"`)
  expect(at('notification-quiet')).toBeGreaterThan(-1)
  expect(at('notification-quiet')).toBeLessThan(at('notification-default'))
  expect(at('notification-default')).toBeLessThan(at('notification-exceptions'))
  expect(at('notification-exceptions')).toBeLessThan(at('push-card'))
  expect(w.find('[data-testid="notification-quiet"]').text()).toContain('Turns off every notification, no exceptions')
  expect(w.find('[data-testid="push-card"]').text()).toContain('What notifies is set above')
  w.unmount()
  desk.value = wasDesk
})
