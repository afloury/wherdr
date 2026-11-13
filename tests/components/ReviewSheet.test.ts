// WHR-294: Home's Tasks to review card counts what waits for the user on the
// home tab's projects; a tap opens the review sheet, one task at a time: Approve
// (Accept, the next one shows), Skip (it stays), previous and next, the keys,
// All done after the last; its filter follows the group tab by default.
import { afterEach, expect, it } from 'vitest'
import { readBody } from 'h3'
import { mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import ReviewCard from '~/components/ReviewCard.vue'
import { coordinators } from '~/composables/useCoordinators'
import { machineBarSaved, machineGroups } from '~/composables/useMachineBar'
import { reviewFilter, reviewOpen } from '~/composables/useReview'
import { toHandle, type Card } from '#shared/pm/board'

const plan = [{ id: 'work', holder: 'worker', ends: 'report' }, { id: 'review', holder: 'reviewer', ends: 'verdict' }, { id: 'merge', holder: 'user' }]
const card = (id: string, project: string, over: Partial<Card> = {}): Card => ({
  id, shown: id, project, title: `Task ${id}`, description: '', column: 'Merge', phase: 'your-turn', holder: 'user', tags: [], log: [],
  links: [{ label: 'PR', url: `https://example.com/o/r/pull/${id.length}` }], plan: plan as Card['plan'], yourTurn: 'Merge', userLabel: 'Accept', tldr: `What ${id} changes.`,
  state: { at: 2, started: true, proofs: {}, rounds: { review: 1 }, yourTurn: { reason: 'user', badge: 'Merge' }, shots: { work: [{ file: 'aaaaaaaaaaaa.png', phase: 'after', at: 1 }] } },
  ...over,
})
let cards: Card[] = []
const accepted: string[] = []
registerEndpoint('/api/pm/board', () => ({ projects: [{ key: 'home', name: 'Home', columns: [], types: [] }, { key: 'work', name: 'Work', columns: [], types: [] }], cards }))
registerEndpoint('/api/pm/handle', () => toHandle(cards))
registerEndpoint('/api/pm/step-user', { method: 'POST', handler: async (e) => {
  const { id } = await readBody(e) as { id: string }
  accepted.push(id)
  cards = cards.filter(c => c.id !== id)
  return { task: { id } }
} })
afterEach(() => { reviewOpen.value = false; reviewFilter.value = null; accepted.length = 0 })

const sheet = () => document.querySelector('[data-testid="review-sheet"]')
const q = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`)
const shown = () => sheet()?.querySelector('[data-testid="review-item"]')?.getAttribute('data-task') ?? (q('review-done') ? 'done' : null)
const progress = () => q('review-progress')?.textContent

it('counts what waits on Home and reviews it one by one: Approve, Skip, previous, next and the keys', async () => {
  cards = [card('HO-1', 'home'), card('HO-2', 'home', { tldr: undefined, state: { at: 2, started: true, proofs: {}, rounds: {}, yourTurn: { reason: 'user', badge: 'Merge' } } }),
    card('HO-3', 'home', { yourTurn: 'Its agent asks', userLabel: undefined, asks: { kind: 'question', text: 'Which database?' }, terminal: 'host/t1', state: { at: 0, started: true, proofs: {}, rounds: {} } })]
  const w = await mountSuspended(ReviewCard)
  await expect.poll(() => w.find('[data-testid="review-count"]').exists() && w.find('[data-testid="review-count"]').text()).toBe('3')
  await w.find('[data-testid="review-open"]').trigger('click')
  await expect.poll(shown).toBe('HO-1')
  // A task to approve: TL;DR, its screenshots, its PR and the verdict in one line.
  expect(sheet()!.querySelector('[data-testid="todo-tldr"]')?.textContent).toContain('What HO-1 changes.')
  expect(sheet()!.querySelectorAll('[data-testid="shot"]').length).toBe(1)
  expect([q('review-pr')?.textContent, q('review-verdict')?.textContent]).toEqual(['PR #4', 'Review passed, 1 send-back'])
  expect(progress()).toBe('1 of 3')

  q('review-skip')!.click() // Skip: the next one, the skipped one stays
  await expect.poll(shown).toBe('HO-2')
  expect(q('shot')).toBeNull() // no screenshots
  q('review-prev')!.click()
  await expect.poll(shown).toBe('HO-1')
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
  await expect.poll(shown).toBe('HO-2')
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true })) // A: approve
  await expect.poll(shown).toBe('HO-3') // it leaves the list, the next one shows
  expect(accepted).toEqual(['HO-2'])
  expect(progress()).toBe('2 of 2')
  // Anything else that waits shows its own answer, no Approve.
  expect([q('review-approve'), q('review-say')?.textContent, q('review-answer')?.textContent]).toEqual([null, 'Its agent asks', 'Answer the agent'])

  document.dispatchEvent(new KeyboardEvent('keydown', { key: 's', bubbles: true })) // S: skip the last one
  await expect.poll(shown).toBe('done')
  expect(q('review-done')!.textContent).toContain('2 skipped, still in the list.')
  q('review-restart')!.click()
  await expect.poll(shown).toBe('HO-1')
  q('review-approve')!.click()
  await expect.poll(shown).toBe('HO-3')
  expect(accepted).toEqual(['HO-2', 'HO-1'])
  w.unmount()
})

it('follows the group tab by default, and keeps the filter picked', async () => {
  coordinators.value = [{ project: 'home', name: 'Home', machines: ['laptop'] }, { project: 'work', name: 'Work', machines: ['office'] }]
  machineGroups.value = [{ id: '*group:personal', name: 'Personal', machines: ['laptop'] }, { id: '*group:work', name: 'Work', machines: ['office'] }]
  cards = [card('HO-1', 'home'), card('WK-1', 'work')]
  try {
    machineBarSaved.value = '*group:personal'
    reviewOpen.value = true
    const w = await mountSuspended(ReviewCard)
    await expect.poll(() => w.find('[data-testid="review-count"]').exists() && w.find('[data-testid="review-count"]').text()).toBe('1')
    await expect.poll(shown).toBe('HO-1')
    expect(progress()).toBe('1 of 1')
    machineBarSaved.value = '*group:work' // the tab changes: the sheet follows it
    await expect.poll(shown).toBe('WK-1')
    reviewFilter.value = 'p:home' // one project, kept like the Board's picker
    await expect.poll(shown).toBe('HO-1')
    reviewFilter.value = '*group:work' // one group, whatever the tab
    machineBarSaved.value = '*group:personal'
    await expect.poll(shown).toBe('WK-1')
    reviewFilter.value = 'all'
    await expect.poll(progress).toBe('1 of 2')
    w.unmount()
  } finally { coordinators.value = []; machineGroups.value = []; machineBarSaved.value = null }
})
