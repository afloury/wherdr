import { afterEach, expect, it, vi } from 'vitest'
import { mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import { readBody } from 'h3'
import CoordinatorAutopilot from '~/components/CoordinatorAutopilot.vue'
import type { CoordinatorView } from '#shared/pm/coordinator'
import type { Wake } from '#shared/pm/wakes'

const posts: Record<string, unknown>[] = []
registerEndpoint('/api/pm/coordinators', () => [])
registerEndpoint('/api/pm/autopilot', { method: 'POST', handler: async (e) => { posts.push(await readBody(e)); return {} } })

const autopilot = { on: false, goal: 'Ship 2.1', every: '2h', events: ['done', 'stuck'], perDay: 10, atOnce: 2 } as const
const wake = (id: string, more: Partial<Wake>): Wake => ({ id, coordinator: 'CO', reasons: ['CO-1 (Fix it): done', 'CO-2 (Add it): stuck'], createdAt: Date.UTC(2026, 10, 5, 4, 0), tries: 1, ...more })
const view = (more: Partial<CoordinatorView> = {}): CoordinatorView => ({
  project: 'CO', name: 'Company', agent: { program: 'claude', model: 'opus' }, terminal: 'host/t1',
  autopilot: { ...autopilot, events: [...autopilot.events] }, limits: { started: 3, perDay: 10, startLeft: 1, working: 1, atOnce: 2 },
  wakes: [
    wake('aaaaaaa3', { }),
    wake('aaaaaaa2', { deliveredAt: 2, idleSince: 3 }),
    wake('aaaaaaa1', { deliveredAt: 2, ackedAt: 3, endedAt: 3, ended: 'ack' }),
    wake('aaaaaaa0', { deliveredAt: 2, tries: 2, endedAt: 3, ended: 'unanswered' }),
  ],
  ...more,
})
let w: Awaited<ReturnType<typeof mountSuspended>> | null = null
const mount = async (c = view()) => (w = await mountSuspended(CoordinatorAutopilot, { props: { c } }))
afterEach(() => { w?.unmount(); w = null; posts.length = 0 })

it('shows today\'s counters against the limits, and the switch saves the autopilot as it is', async () => {
  const b = await mount()
  expect(b.find('[data-testid="autopilot-counters"]').text()).toBe('3/10 today · 1/2 at once')
  expect(b.text()).toContain('Autopilot · Off')
  expect(b.text()).toContain('Ship 2.1')
  await b.find('[data-testid="autopilot-on"]').trigger('click')
  await vi.waitFor(() => expect(posts).toEqual([{ project: 'CO', autopilot: { ...autopilot, on: true } }]))
})

it('saves the goal, interval, events and limits edited', async () => {
  const b = await mount()
  await b.find('[data-testid="autopilot-toggle"]').trigger('click')
  await b.find('textarea#ap-goal-CO').setValue('  Fix the board first ')
  await b.find('input#ap-every-CO').setValue('30m')
  await b.find('input#ap-at-CO').setValue(' daily 08:00 ')
  await b.find('input#ap-day-CO').setValue('4')
  await b.find('[data-testid="autopilot-event-ready"]').trigger('click')
  await b.find('[data-testid="autopilot-event-stuck"]').trigger('click')
  await b.find('[data-testid="autopilot-save"]').trigger('submit')
  await vi.waitFor(() => expect(posts).toEqual([{ project: 'CO', autopilot: { ...autopilot, goal: '  Fix the board first ', every: '30m', at: 'daily 08:00', perDay: 4, events: ['done', 'ready'] } }]))
})

it('lists the wakes as waiting, delivered, acked or unanswered, and runs now', async () => {
  const b = await mount()
  await b.find('[data-testid="autopilot-toggle"]').trigger('click')
  const rows = b.findAll('[data-testid="autopilot-wake"]')
  expect(rows.map(r => r.attributes('data-state'))).toEqual(['pending', 'delivered', 'ack', 'unanswered'])
  expect(rows.map(r => r.find('.ap-state').text())).toEqual(['Waiting', 'Delivered', 'Acked', 'No answer'])
  expect(rows[0]!.text()).toContain('Delivered — · Acked —')
  expect(rows[0]!.text()).toContain('CO-1 (Fix it): done (+1)')
  expect(rows[3]!.text()).toContain('×2')
  await b.find('[data-testid="autopilot-run-now"]').trigger('click')
  await vi.waitFor(() => expect(posts).toEqual([{ project: 'CO', runNow: true }]))
  await vi.waitFor(() => expect(b.text()).toContain('Queued: it goes as soon as the coordinator is idle.'))
})

it('cannot run a coordinator that is not started', async () => {
  const b = await mount(view({ terminal: undefined, wakes: [] }))
  await b.find('[data-testid="autopilot-toggle"]').trigger('click')
  expect(b.find('[data-testid="autopilot-run-now"]').attributes('disabled')).toBeDefined()
  expect(b.text()).toContain('Start the coordinator to wake it.')
  expect(b.text()).toContain('No wake yet.')
})

it('shows Active, or Asleep with its last wake when there is nothing to do', async () => {
  const on = { ...autopilot, on: true, events: [...autopilot.events] }
  const woke = new Date(); woke.setHours(9, 5, 0, 0)
  let b = await mount(view({ autopilot: on }))
  expect(b.find('[data-testid="autopilot-state"]').text()).toBe('Autopilot · Active')
  b.unmount()
  b = await mount(view({ autopilot: on, asleep: 'idle', wokeAt: woke.getTime() }))
  const state = b.find('[data-testid="autopilot-state"]')
  expect(state.text()).toMatch(/^Autopilot · Asleep · nothing to do · woke 09:05/)
  expect(state.attributes('data-asleep')).toBeDefined()
  b.unmount()
  b = await mount(view({ autopilot: on, asleep: 'limit' }))
  expect(b.find('[data-testid="autopilot-state"]').text()).toBe('Autopilot · Asleep · new work limit reached until tomorrow')
  b.unmount()
  // Off: never asleep.
  b = await mount(view({ asleep: 'idle' }))
  expect(b.find('[data-testid="autopilot-state"]').text()).toBe('Autopilot · Off')
})

it('saves "look for new work" only when on, with its daily limit', async () => {
  const b = await mount()
  await b.find('[data-testid="autopilot-toggle"]').trigger('click')
  expect(b.find('[data-testid="autopilot-look-per-day"]').exists()).toBe(false)
  await b.find('[data-testid="autopilot-look-for-work"]').trigger('click')
  expect((b.find('input#ap-look-CO').element as HTMLInputElement).value).toBe('3')
  await b.find('input#ap-look-CO').setValue('5')
  await b.find('[data-testid="autopilot-save"]').trigger('submit')
  await vi.waitFor(() => expect(posts).toEqual([{ project: 'CO', autopilot: { ...autopilot, at: '', lookForWork: true, lookPerDay: 5 } }]))
})
