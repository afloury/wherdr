// SRC-62: what the user did elsewhere (answered a task's agent in its own session,
// pressed a step's button, marked it done) shows in the review entry and on the
// coordinator's open cards, which read as answered: no answer pressed, never a
// change of the task.
import { afterEach, expect, it } from 'vitest'
import { mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import ChatView from '~/components/ChatView.vue'
import ProposalCard from '~/components/ProposalCard.vue'
import QuestionsCard from '~/components/QuestionsCard.vue'
import ReviewSheet from '~/components/ReviewSheet.vue'
import { coordinators } from '~/composables/useCoordinators'
import { cachedAt, herdrState } from '~/composables/useHerdr'
import { reviewFilter } from '~/composables/useReview'
import { toHandle, type Card } from '#shared/pm/board'
import type { CoordinatorView } from '#shared/pm/coordinator'
import type { Elsewhere } from '#shared/pm/elsewhere'
import type { ChatItem, Pane } from '#shared/types'

const pane: Pane = { id: 'w1:p1', coreAddress: 'core:coord', workspace: 'w1', tab: 'w1:t1', tabLabel: null, agent: 'claude', name: null, label: null, status: 'idle', title: null, cwd: '/tmp/demo', agentSession: null }
const at = new Date('2026-01-01T09:30:00Z').getTime()
const view = (over: Partial<CoordinatorView> = {}): CoordinatorView => ({ project: 'CO', name: 'Company', terminal: 'core:coord', ...over })
const reply: Elsewhere = { task: 'CO-4', shown: 'CO-4', at: at + 60_000, what: 'reply', role: 'worker', said: 'use squash' }

const items: ChatItem[] = [
  { role: 'assistant', text: 'How shall CO-4 merge?\n\n```wherdr\nchoices "Squash" | "Rebase"\n```', ts: '2026-01-01T09:30:00Z' },
  { role: 'assistant', text: 'And CO-9, which way?\n\n```wherdr\nchoices "Squash" | "Rebase"\n```', ts: '2026-01-01T09:31:00Z' },
]
registerEndpoint('/api/chat', () => ({ available: true, token: 'elsewhere', file: '/tmp/demo/t.jsonl', items }))
const mount = () => mountSuspended(ChatView, { props: { pane, localQueued: [] }, global: { stubs: { UTooltip: { template: '<slot />' } } } })

afterEach(() => { herdrState.value = { ok: false, workspaces: [], panes: [] }; cachedAt.value = null; coordinators.value = [] })

it('a reply to the task\'s agent leaves the coordinator\'s card open; a step or done marks only its card', async () => {
  herdrState.value = { ok: true, workspaces: [], panes: [pane] }
  coordinators.value = [view({ elsewhere: [reply] })]
  const w = await mount()
  try {
    await expect.poll(() => w.findAll('.w-choices').length).toBe(2)
    const [about, other] = w.findAll('.w-choices')
    await new Promise(r => setTimeout(r, 100))
    expect(about!.classes()).not.toContain('done') // CO-4: only a reply to its worker
    expect(about!.attributes('data-note')).toBeUndefined()
    expect(about!.findAll('button').some(b => b.element.hasAttribute('disabled'))).toBe(false)
    expect(other!.classes()).not.toContain('done')
    // A step button reads as answered elsewhere; live, without reload.
    coordinators.value = [view({ elsewhere: [{ ...reply, task: 'CO-9', shown: 'CO-9', at: at + 120_000, what: 'step' }] })]
    await expect.poll(() => other!.attributes('data-note')).toBe('Answered elsewhere')
    expect(about!.classes()).not.toContain('done')
  } finally { w.unmount() }
})

it('a questions card shows the note, closed', async () => {
  const w = await mountSuspended(QuestionsCard, { props: { items: [{ q: 'Which?', options: ['A', 'B'] }], live: false, given: null, note: 'Answered elsewhere' } })
  expect(w.find('[data-testid="questions-note"]').text()).toBe('Answered elsewhere')
  expect(w.findAll('button:disabled').length).toBe(2)
  expect(w.find('[data-testid="questions-send"]').exists()).toBe(false)
})

it('a proposal answered elsewhere reads as answered, no buttons', async () => {
  const c = view({ proposal: { diff: '+ x', at: 1, changes: { all: [], types: [] } }, proposalElsewhere: 'applied through the project\'s coordinator' })
  const w = await mountSuspended(ProposalCard, { props: { c } })
  expect(w.find('[data-testid="proposal-outcome"]').text()).toBe('Answered elsewhere: applied through the project\'s coordinator')
  expect(w.find('button').exists()).toBe(false)
})

it('the review entry shows when the user replied to the agent, and the line goes with it', async () => {
  const plan = [{ id: 'work', holder: 'worker', ends: 'report' }, { id: 'merge', holder: 'user', ends: 'user', action: { kind: 'github.merge' } }]
  const base: Card = { id: 'CO-4', shown: 'CO-4', project: 'home', title: 'Task', description: '', column: 'Merge', phase: 'your-turn', holder: 'user', tags: [], log: [], links: [], plan: plan as Card['plan'], yourTurn: 'Merge', tldr: 'It changes.', state: { at: 1, started: true, proofs: {}, rounds: {}, yourTurn: { reason: 'user', badge: 'Merge' } } }
  let cards: Card[] = [{ ...base, replied: { at, role: 'worker', said: 'use squash' } }]
  registerEndpoint('/api/pm/board', () => ({ projects: [{ key: 'home', name: 'Home', columns: [], types: [] }], cards }))
  registerEndpoint('/api/pm/handle', () => toHandle(cards))
  reviewFilter.value = null
  const w = await mountSuspended(ReviewSheet)
  try {
    const line = () => document.querySelector('[data-testid="task-replied"]')?.textContent
    await expect.poll(line).toMatch(/^You replied to the agent at \d\d:\d\d: use squash$/)
    expect(document.querySelector('[data-testid="todo-tldr"]')?.textContent).toContain('It changes.')
    cards = [base] // the agent reported after it: the server cleared it
    await expect.poll(line, { timeout: 15_000 }).toBeUndefined()
  } finally { w.unmount() }
}, 30_000)
