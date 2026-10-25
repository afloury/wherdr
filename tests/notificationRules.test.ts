import { describe, expect, it } from 'vitest'
import { COORDINATOR_EVENTS, NOTIFICATION_EVENTS, NotificationPresence, defaultNotifications, notificationEvents,
  paneNotificationSource, parseNotificationSettings, type NotificationRule, type NotificationSettings } from '../shared/notificationRules'
import type { MachineLinks } from '../shared/boardLinks'

const source = { machine: '', project: 'example', conversation: 'w1:p1' }
const rule = (scope: NotificationRule['scope'], mode: NotificationRule['mode'], opts: Partial<NotificationRule> = {}): NotificationRule => ({
  scope, mode, machine: '', id: scope === 'conversation' ? 'w1:p1' : scope === 'project' ? 'example' : '',
  label: 'Example', events: [...NOTIFICATION_EVENTS], until: null, ...opts,
})
const settings = (...rules: NotificationRule[]): NotificationSettings => ({ ...defaultNotifications(), rules })

describe('notification inheritance', () => {
  it('is quiet by default, with only needs-you and finished for coordinators', () => {
    expect(notificationEvents(settings(), source)).toEqual([])
    expect(notificationEvents(settings(), { ...source, coordinator: true })).toEqual(COORDINATOR_EVENTS)
  })
  it('uses machine → project → conversation, scoped to each machine', () => {
    const s = settings(rule('machine', 'on'), rule('project', 'muted'), rule('conversation', 'on', { events: ['needs-you'] }))
    expect(notificationEvents(s, source)).toEqual(['needs-you'])
    expect(notificationEvents(s, { ...source, conversation: 'w1:p2' })).toEqual([])
    expect(notificationEvents(s, { ...source, project: 'other', conversation: 'w1:p2' })).toEqual(NOTIFICATION_EVENTS)
    expect(notificationEvents(s, { ...source, machine: 'abcd' })).toEqual([])
  })
  it('inherits explicitly and after a timed mute expires', () => {
    const s = settings(rule('machine', 'on', { events: ['message'] }), rule('project', 'inherit'), rule('conversation', 'muted', { until: 5000 }))
    expect(notificationEvents(s, source, 4999)).toEqual([])
    expect(notificationEvents(s, source, 5000)).toEqual(['message'])
  })
  it('lets a permanent machine mute override a coordinator default', () => {
    expect(notificationEvents(settings(rule('machine', 'muted')), { ...source, coordinator: true })).toEqual([])
  })
  it.each(NOTIFICATION_EVENTS)('selects %s independently', event => {
    expect(notificationEvents(settings(rule('conversation', 'on', { events: [event] })), source)).toEqual([event])
  })
  it('keeps subagents muted under broad allow rules but permits a manual conversation override', () => {
    const sub = { ...source, subagent: true }
    const s = settings(rule('machine', 'on'), rule('project', 'on'))
    expect(notificationEvents(s, sub)).toEqual([])
    s.rules.push(rule('conversation', 'on', { events: ['finished'] }))
    expect(notificationEvents(s, sub)).toEqual(['finished'])
    s.rules[2]!.until = 1000
    expect(notificationEvents(s, sub, 1000)).toEqual([])
    s.muteSubagents = false
    expect(notificationEvents(s, sub, 1000)).toEqual(NOTIFICATION_EVENTS)
  })
  it('rejects malformed policies and sanitizes unknown events and duplicate targets', () => {
    expect(parseNotificationSettings('{')).toEqual(defaultNotifications())
    const s = parseNotificationSettings(JSON.stringify({ muteSubagents: false, defaults: ['message', 'other'], rules: [
      rule('conversation', 'on'), rule('conversation', 'muted'), { ...rule('machine', 'on'), until: -1 }, { scope: 'wrong' },
    ] }))
    expect(s.defaults).toEqual(['message'])
    expect(s.muteSubagents).toBe(false)
    expect(s.rules).toEqual([rule('conversation', 'muted')])
  })
})

describe('visible conversation leases', () => {
  it('suppresses every device while any recent viewing lease exists', () => {
    const p = new NotificationPresence()
    p.heartbeat('desktop', 'w1:p1', true, 1000)
    p.heartbeat('phone', 'w1:p1', true, 15000)
    expect(p.viewed('w1:p1', 30999)).toBe(true)
    expect(p.viewed('w1:p1', 44999)).toBe(true)
    expect(p.viewed('w1:p1', 45000)).toBe(false)
  })
  it('does not renew a hidden tab, with a grace period after leaving', () => {
    const p = new NotificationPresence()
    p.heartbeat('desktop', 'w1:p1', true, 1000)
    p.heartbeat('desktop', 'w1:p1', false, 15000)
    expect(p.viewed('w1:p1', 30999)).toBe(true)
    p.heartbeat('desktop', 'w1:p1', false, 31000)
    expect(p.viewed('w1:p1', 31000)).toBe(false)
  })
  it('expires a crashed client without a disconnect or hide message', () => {
    const p = new NotificationPresence()
    p.heartbeat('desktop', 'w1:p1', true, 0)
    expect(p.viewed('w1:p2', 1)).toBe(false)
    expect(p.viewed('w1:p1', 30000)).toBe(false)
  })
  it('moves a viewing lease to the newly opened conversation', () => {
    const p = new NotificationPresence()
    p.heartbeat('desktop', 'w1:p1', true, 0)
    p.heartbeat('desktop', 'w1:p2', true, 1000)
    expect(p.viewed('w1:p1', 1000)).toBe(false)
    expect(p.viewed('w1:p2', 1000)).toBe(true)
  })
})

describe('board identities', () => {
  const boards: MachineLinks[] = [{ machine: '', coordinators: [
    { level: 'top', pane: 'w1:p1', workspace: 'w1' },
    { level: 'project', repo: 'example', pane: 'w1:p2', workspace: 'w1' },
    { level: 'machine', pane: 'w1:p3', workspace: 'w1' },
  ], tasks: [{ id: 'example/1', repo: 'example', n: 1, key: 'APP-1', title: 'Example',
    panes: [{ id: 'w2:p1', role: 'worker' }, { id: 'w2:p2', role: 'reviewer' }, { id: 'w2:p3', role: 'attempt' }],
    workspace: 'w2', stage: 'working', progress: null, msg: '', since: null,
  }] }]
  it.each(['w1:p1', 'w1:p2', 'w1:p3'])('recognizes coordinator %s by board metadata', id => {
    expect(paneNotificationSource({ id, workspace: 'w1' }, { workspaces: [] }, boards).coordinator).toBe(true)
  })
  it.each(['w2:p1', 'w2:p2', 'w2:p3', 'w2:p4'])('mutes worker, reviewer, attempt and helper %s', id => {
    expect(paneNotificationSource({ id, workspace: 'w2' }, { workspaces: [] }, boards)).toMatchObject({ subagent: true, project: 'example' })
  })
  it('uses the base machine for an ordinary conversation in another session', () => {
    expect(paneNotificationSource({ id: 'abcd~w3:p1', workspace: 'abcd~w3' }, { workspaces: [] }, [], '')).toEqual({ machine: '', project: undefined, conversation: 'abcd~w3:p1' })
  })
})
