import { expect, it, vi } from 'vitest'
import { mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import CoordinatorScheduled from '~/components/CoordinatorScheduled.vue'

let reads = 0
let goal = ''
registerEndpoint('/api/tasks/scheduled', () => {
  reads++
  return { autopilot: goal ? { on: true, goal } : null, automations: [], timers: [], timezone: 'UTC', warnings: [] }
})

it('loads only on disclosure, displays the empty state and refreshes with the board', async () => {
  reads = 0
  const w = await mountSuspended(CoordinatorScheduled, { props: { machine: '', target: { kind: 'main' }, refreshKey: 0 } })
  expect(reads).toBe(0)
  const details = w.get('details')
  details.element.open = true
  await details.trigger('toggle')
  await vi.waitFor(() => expect(w.text()).toContain('Nothing scheduled'))
  expect(reads).toBe(1)
  await w.setProps({ refreshKey: 1 })
  await vi.waitFor(() => expect(reads).toBe(2))
  details.element.open = false
  await details.trigger('toggle')
  await w.setProps({ refreshKey: 2 })
  expect(reads).toBe(2)
  w.unmount()
})

it('rereads on reopening without waiting for a board refresh', async () => {
  reads = 0
  goal = 'Keep the build green'
  const w = await mountSuspended(CoordinatorScheduled, { props: { machine: '', target: { kind: 'main' } } })
  const details = w.get('details')
  details.element.open = true
  await details.trigger('toggle')
  await vi.waitFor(() => expect(w.text()).toContain(goal))
  const before = reads
  details.element.open = false
  await details.trigger('toggle')
  goal = ''
  details.element.open = true
  await details.trigger('toggle')
  await vi.waitFor(() => expect(w.text()).toContain('Nothing scheduled'))
  expect(reads).toBeGreaterThan(before)
  expect(w.text()).not.toContain('Keep the build green')
  w.unmount()
})
