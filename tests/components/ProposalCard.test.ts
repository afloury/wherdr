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

it('answered: its own change, the outcome, by whom and when, and no buttons, even while another waits', async () => {
  w = await mountSuspended(ProposalCard, { props: { c: pending, answer: { outcome: 'refused', at: 2, by: 'user', proposedAt: 1, summary: ['task: + land'] } } })
  expect(w.text()).toContain('task: + land')
  expect(w.text()).not.toContain('automatic')
  expect(w.find('[data-testid="proposal-outcome"]').text()).toMatch(/^Refused by you · /)
  expect(w.find('button').exists()).toBe(false)
  await w.setProps({ answer: { outcome: 'replaced', at: 3, by: 'coordinator CO', proposedAt: 1 } })
  expect(w.find('[data-testid="proposal-outcome"]').text()).toMatch(/^Replaced by coordinator CO · /)
})

it('says who proposed it and the request behind it: in full when unfolded, with a link back to it', async () => {
  const said = `Never run the full suite locally. ${'Only the tests of what changed. '.repeat(12)}`
  const c: CoordinatorView = { ...pending, label: 'WD', color: 'teal', proposal: { ...pending.proposal!, by: 'CO', said, saidAt: Date.UTC(2026, 0, 2, 9, 30) } }
  w = await mountSuspended(ProposalCard, { props: { c, canGoto: true } })
  expect(w.find('[data-testid="proposal-headline"]').text()).toBe('task: merge: you → automatic')
  expect(w.find('[data-testid="proposal-by"]').text()).toBe('Proposed by WD coordinator')
  expect(w.find('[data-testid="proposal-key"]').attributes('style')).toContain('--project-teal')
  const text = w.find('[data-testid="proposal-said"]')
  expect(text.text()).toBe(said.trim())
  expect(text.classes()).toContain('folded')
  await w.find('[data-testid="proposal-said-more"]').trigger('click')
  expect(text.classes()).not.toContain('folded')
  await w.find('[data-testid="proposal-goto"]').trigger('click')
  expect(w.emitted('goto')).toHaveLength(1)
})

it('proposed by Alfred: his name, no key badge; a short request is not folded', async () => {
  const c: CoordinatorView = { ...pending, color: 'teal', proposal: { ...pending.proposal!, by: 'main', said: 'Add a deploy step' } }
  w = await mountSuspended(ProposalCard, { props: { c } })
  expect(w.find('[data-testid="proposal-by"]').text()).toBe('Proposed by Alfred')
  expect(w.find('[data-testid="proposal-key"]').exists()).toBe(false)
  expect(w.find('[data-testid="proposal-said-more"]').exists()).toBe(false)
  expect(w.find('[data-testid="proposal-goto"]').exists()).toBe(false)
})
