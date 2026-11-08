import { afterEach, expect, it, vi } from 'vitest'
import { mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import { readBody } from 'h3'
import ProposalCard from '~/components/ProposalCard.vue'
import type { CoordinatorView } from '#shared/pm/coordinator'

const posts: unknown[] = []
registerEndpoint('/api/pm/coordinators', () => [])
registerEndpoint('/api/pm/template-proposal', { method: 'POST', handler: async (e) => { posts.push(await readBody(e)); return { accepted: true } } })

const changes = { all: [], types: [{ type: 'task', kind: 'changed' as const, fields: [{ field: 'merge', before: 'you', after: 'automatic' }], steps: [] }] }
const pending: CoordinatorView = { project: 'CO', name: 'Company', proposal: { diff: '+ x', at: 1, changes } }
let w: Awaited<ReturnType<typeof mountSuspended>> | null = null
afterEach(() => { w?.unmount(); w = null; posts.length = 0 })

it('pending: the change in a line, Accept answers it, See all changes opens the review', async () => {
  w = await mountSuspended(ProposalCard, { props: { c: pending } })
  expect(w.text()).toContain('task: merge: you → automatic')
  await w.find('[data-testid="proposal-card-accept"]').trigger('click')
  await vi.waitFor(() => expect(posts).toEqual([{ project: 'CO', accept: true }]))
  await w.find('[data-testid="proposal-see"]').trigger('click')
  await vi.waitFor(() => expect(document.querySelector('[data-testid="proposal-changes"]')?.textContent).toContain('automatic'))
})

it('answered: the outcome, by whom and when, and no buttons', async () => {
  w = await mountSuspended(ProposalCard, { props: { c: { project: 'CO', name: 'Company', answered: { outcome: 'refused', at: 2, by: 'user', proposedAt: 1, summary: ['task: + land'] } } } })
  expect(w.text()).toContain('task: + land')
  expect(w.find('[data-testid="proposal-outcome"]').text()).toMatch(/^Refused by you · /)
  expect(w.find('button').exists()).toBe(false)
})
