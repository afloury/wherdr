// Home's Needs you now card lists the tasks whose worker cannot go on without a
// person (ToHandle.needsHuman); hidden when none; a tap opens the task's sheet.
// Tasks to review does not count them again.
import { expect, it } from 'vitest'
import { mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import { useRouter } from '#app'
import NeedsYouCard from '~/components/NeedsYouCard.vue'
import ReviewCard from '~/components/ReviewCard.vue'
import type { ToHandle } from '#shared/pm/board'

const row = (id: string, over: Partial<ToHandle> = {}): ToHandle => ({ id, shown: id, project: 'home', title: `Task ${id}`, action: 'Merge', label: 'Merge', ...over })
let rows: ToHandle[] = []
let reads = 0
registerEndpoint('/api/pm/handle', () => { reads++; return rows })

it('lists only the tasks that need the user now, and a tap opens the sheet', async () => {
  rows = [
    row('HO-1', { title: 'Sign in to the registry', needsHuman: { kind: 'login', url: 'https://example.com/sign-in', at: 1 } }),
    row('HO-2'),
  ]
  const w = await mountSuspended(NeedsYouCard)
  await expect.poll(() => w.findAll('[data-testid="needs-you-row"]').length).toBe(1)
  const r = w.find('[data-testid="needs-you-row"]')
  expect(r.attributes('data-task')).toBe('HO-1')
  expect(w.text()).toContain('Needs you now')
  expect([r.find('b').text(), r.find('[data-testid="needs-you-kind"]').text(), r.find('[data-testid="needs-you-url"]').text()]).toEqual(['Sign in to the registry', 'login', 'https://example.com/sign-in'])
  expect(w.text()).not.toContain('Task HO-2')
  await r.trigger('click')
  await expect.poll(() => useRouter().currentRoute.value.fullPath).toBe('/?task=HO-1')
  w.unmount()
  await useRouter().replace('/')
}, 40000)

it('shows nothing when no task needs the user', async () => {
  rows = [row('HO-2')]
  const before = reads
  const w = await mountSuspended(NeedsYouCard)
  await expect.poll(() => reads).toBeGreaterThan(before)
  await w.vm.$nextTick()
  expect(w.find('[data-testid="needs-you"]').exists()).toBe(false)
  w.unmount()
})

it('Tasks to review leaves them to their own card', async () => {
  rows = [row('HO-1', { needsHuman: { kind: 'login', at: 1 } }), row('HO-2'), row('HO-3')]
  const w = await mountSuspended(ReviewCard)
  await expect.poll(() => w.find('[data-testid="review-count"]').exists()).toBe(true)
  expect(w.find('[data-testid="review-count"]').text()).toBe('2')
  expect(w.find('[data-testid="review-ids"]').text()).not.toContain('HO-1')
  w.unmount()
})
