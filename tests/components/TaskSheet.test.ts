import { expect, it, vi } from 'vitest'
import { mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import TaskSheet from '~/components/TaskSheet.vue'
import { initialState, planSteps, type StepState } from '#shared/pm/steps'
import { company, wherdr } from '#shared/pm/examples'
import { readBody } from 'h3'
import { cardOf, linkLabel, mainLink, type Card } from '#shared/pm/board'
import type { Task } from '#shared/pm/run'

const badge = 'Look at the screenshots, then merge: merge: the PR head is not the task\'s commit'
let release: () => void = () => {}
registerEndpoint('/api/pm/step-user', { method: 'POST', handler: async () => {
  await new Promise<void>((r) => { release = r })
  return { task: { id: 'WHR-1', step: { ...initialState(), started: true, at: 1, yourTurn: { reason: 'action', badge } } } }
} })

const card: Card = {
  id: 'WHR-1', project: 'WHR', title: 'A task', description: '', column: 'Merging', phase: 'working', step: 'merge', holder: 'none',
  yourTurn: 'Look at the screenshots, then merge', userLabel: 'Merge', tags: [], links: [], log: [], plan: [], state: { ...initialState(), started: true, at: 1 },
}
const stubs = { AppSheet: { template: '<section><slot /></section>' } }

it('shows the merge running, then a refusal in plain words under the button and on the badge', async () => {
  const w = await mountSuspended(TaskSheet, { props: { card }, global: { stubs } })
  await w.get('[data-testid="step-user"]').trigger('click')
  await vi.waitFor(() => expect(w.find('[data-testid="step-user-busy"]').exists()).toBe(true))
  release()
  const said = 'The PR on GitHub is not at the task\'s latest commit'
  await vi.waitFor(() => expect(w.get('[data-testid="step-user-refused"]').text()).toContain(said))
  expect(w.find('[data-testid="step-user-busy"]').exists()).toBe(false)
  expect(w.find('[data-testid="task-badge"]').exists()).toBe(false) // said once, under the button
  // The board read again: the badge carries the refusal, phrased the same; a new step clears it.
  await w.setProps({ card: { ...card, yourTurn: badge } })
  expect(w.get('[data-testid="step-user-refused"]').text()).toContain(said)
  await w.setProps({ card: { ...card, yourTurn: 'Deploy' } })
  expect(w.find('[data-testid="step-user-refused"]').exists()).toBe(false)
  expect(w.get('[data-testid="task-badge"]').text()).toBe('Deploy')
  await w.setProps({ card: { ...card, yourTurn: 'Merge: merge: 2 check(s) failed' } })
  expect(w.get('[data-testid="task-badge"]').text()).toContain('2 check(s) failed on the PR: the agent is asked to fix them')
  w.unmount()
})

// Each case of a task waiting for the user opens on To do, with what it needs.
const plan = planSteps(wherdr, { type: 'visual' })
const at = (i: number, more: Partial<StepState> = {}): StepState => ({ ...initialState(), started: true, at: i, ...more })
const waiting = (more: Partial<Card>): Card => ({ ...card, plan, userLabel: undefined, ...more })
const cases: [string, Card, string, string[]][] = [
  ['a visual merge', waiting({
    yourTurn: 'Look at the screenshots, then merge', userLabel: 'Merge', links: [{ label: 'pr', url: 'https://github.com/o/r/pull/7' }],
    state: at(4, { yourTurn: { reason: 'user', badge: 'Look at the screenshots, then merge' }, rounds: { review: 1 }, shots: { work: [{ file: 'aaaaaaaaaaaa.png', phase: 'after', at: 1 }] } }),
  }), 'merge', ['todo-shots', 'step-user', 'todo-back', 'todo-pr', 'todo-review-note']],
  ['a decision after send-backs', waiting({
    yourTurn: 'Decide: review failed 4 times',
    state: at(3, { yourTurn: { reason: 'rounds', badge: 'Decide: review failed 4 times', advice: { outcome: 'round', why: 'New finding: x', options: ['round', 'split'], findings: [] } } }),
  }), 'decide', []],
  ['a stopped task', waiting({ yourTurn: 'Stopped by the user: wrong way', stopped: { by: 'the user', why: 'wrong way', at: 1 }, state: at(1) }), 'stopped', []],
  ['a step the user ends', waiting({ yourTurn: 'Deploy it', userLabel: 'Deployed', state: at(4, { yourTurn: { reason: 'user', badge: 'Deploy it' } }) }), 'step', ['step-user']],
  ['an agent question', waiting({ yourTurn: 'Which port?', asks: { kind: 'question', text: 'Which port?' }, state: at(1) }), 'ask', []],
  ['a refused merge', waiting({ yourTurn: 'Merge: merge: 2 check(s) failed', state: at(4, { yourTurn: { reason: 'action', badge: 'Merge: merge: 2 check(s) failed' } }) }), 'refused', ['task-retry', 'task-report-start']],
  ['a blocked task', waiting({ yourTurn: 'WHR-2, which this task starts after, failed', phase: 'todo', state: undefined }), 'blocked', ['task-start']],
]

it.each(cases)('%s opens on To do with what it needs', async (_, c, kind, shown) => {
  const w = await mountSuspended(TaskSheet, { props: { card: c }, global: { stubs } })
  expect(w.get('[role="tab"][aria-selected="true"]').attributes('data-tab')).toBe('todo')
  expect(w.get('[data-testid="task-todo"]').attributes('data-todo')).toBe(kind)
  for (const id of shown) expect(w.find(`[data-testid="${id}"]`).exists(), id).toBe(true)
  if (kind === 'decide') expect(w.findAll('[data-choice]').map(b => b.attributes('data-choice'))).toEqual(['round', 'split'])
  if (kind === 'stopped') expect(w.findAll('[data-resume]').map(b => b.attributes('data-resume'))).toEqual(['continue', 'as-is', 'archive'])
  if (kind === 'ask') expect(w.get('[data-testid="task-badge"]').text()).toBe('Which port?')
  w.unmount()
})

it('a task not waiting for the user opens as before, on its description', async () => {
  const w = await mountSuspended(TaskSheet, { props: { card: { ...card, description: 'Do it', yourTurn: undefined, userLabel: undefined } }, global: { stubs } })
  expect(w.get('[role="tab"][aria-selected="true"]').attributes('data-tab')).toBe('description')
  expect(w.find('[data-tab="todo"]').exists()).toBe(false)
  w.unmount()
})

// A PR the worker opened with its own tool (Bitbucket here), given as the pr step's link proof.
it('a link proof that is a PR shows Open the PR at the merge step and on the card', async () => {
  const url = 'https://bitbucket.org/example-org/example-repo/pull-requests/12'
  const task: Task = {
    id: 'WHR-1', project: 'WHR', title: 'A task', description: '', type: 'feature', state: 'working',
    step: { ...initialState(), started: true, at: 4, proofs: { pr: { link: url } }, yourTurn: { reason: 'user', badge: 'Merge the PR on Bitbucket' } },
  }
  const c = cardOf(task, planSteps(company, { type: 'feature' }), [])
  expect(mainLink(c)).toEqual({ label: 'PR', url })
  expect(linkLabel(mainLink(c)!)).toBe('PR #12')
  const w = await mountSuspended(TaskSheet, { props: { card: c }, global: { stubs } })
  expect(w.get('[data-testid="task-todo"]').attributes('data-todo')).toBe('step')
  expect(w.get('[data-testid="todo-pr"]').attributes('href')).toBe(url)
  expect(w.get('[data-testid="step-user"]').text()).toBe('I merged it')
  w.unmount()
  // A proof stored with the note's closing period is still the PR.
  const dotted = cardOf({ ...task, step: { ...task.step!, proofs: { pr: { link: `${url}.` } } } }, planSteps(company, { type: 'feature' }), [])
  expect(linkLabel(mainLink(dotted)!)).toBe('PR #12')
})

let sentBack: unknown
registerEndpoint('/api/pm/step-back', { method: 'POST', handler: async (e) => { sentBack = await readBody(e); return { task: {} } } })
it('a visual merge is sent back with a note', async () => {
  const w = await mountSuspended(TaskSheet, { props: { card: cases[0]![1] }, global: { stubs } })
  await w.get('textarea[data-testid="todo-back-note"]').setValue('The button is cut on the phone')
  await w.get('[data-testid="todo-back"]').trigger('submit')
  await vi.waitFor(() => expect(sentBack).toEqual({ id: 'WHR-1', note: 'The button is cut on the phone' }))
  w.unmount()
})

// A review over its time limit, its reviewer gone: one plain sentence and Restart the review.
let restarted: unknown
registerEndpoint('/api/pm/review-restart', { method: 'POST', handler: async (e) => { restarted = await readBody(e); return { task: {} } } })
it('a stalled review says why in plain words and restarts the review', async () => {
  const review = plan.findIndex(p => p.id === 'review')
  const c = waiting({ holder: 'reviewer', step: 'review', yourTurn: 'Check review: over 45m', state: at(review, { yourTurn: { reason: 'timeout', badge: 'Check review: over 45m' } }) })
  const w = await mountSuspended(TaskSheet, { props: { card: c }, global: { stubs } })
  expect(w.get('[data-testid="task-todo"]').attributes('data-todo')).toBe('review')
  expect(w.get('[data-testid="task-badge"]').text()).toBe('The reviewer stopped without giving a verdict. Restart the review to review the PR\'s latest commit again.')
  await w.get('[data-testid="todo-review-restart"]').trigger('click')
  await vi.waitFor(() => expect(restarted).toEqual({ id: 'WHR-1' }))
  w.unmount()
})

it('shows the spec changes under the description, newest last', async () => {
  const specNotes = [{ at: 1, by: 'coordinator CO', text: 'Keep the light theme.' }, { at: 2, by: 'coordinator CO', text: 'No toggle.' }]
  const w = await mountSuspended(TaskSheet, { props: { card: { ...card, yourTurn: undefined, description: 'A dark theme.', specNotes } }, global: { stubs } })
  await w.get('[data-tab="description"]').trigger('click')
  const html = w.get('[data-testid="task-panel"]').html()
  expect(html.indexOf('task-description')).toBeLessThan(html.indexOf('task-spec-notes'))
  expect(w.findAll('.task-spec-note').map(n => n.text().split(' ').slice(-2).join(' '))).toEqual(['light theme.', 'No toggle.'])
  w.unmount()
})

it('renders the description as Markdown, with no raw HTML', async () => {
  const description = 'Intro with **bold** and `npm test`.\n\n- one\n- two\n\n<img src=x onerror="alert(1)"><script>alert(2)</script><b style="color:red">raw</b>'
  const w = await mountSuspended(TaskSheet, { props: { card: { ...card, yourTurn: undefined, description } }, global: { stubs } })
  await w.get('[data-tab="description"]').trigger('click')
  const desc = w.get('[data-testid="task-description"]')
  expect(desc.find('strong').text()).toBe('bold')
  expect(desc.find('code').text()).toBe('npm test')
  expect(desc.find('code').attributes('role')).toBeUndefined() // not a chat control here
  expect(desc.findAll('li').map(li => li.text())).toEqual(['one', 'two'])
  expect(desc.find('script').exists()).toBe(false)
  expect(desc.find('[onerror]').exists()).toBe(false)
  expect(desc.find('[style]').exists()).toBe(false)
  expect(desc.text()).toContain('<script>alert(2)</script>') // shown as text
  w.unmount()
})

it('a merge step shows the worker\'s and the reviewer\'s notes, full width, folded, with Show more, as tabs on the phone', async () => {
  const report = 'Added the **notes**.\n\n- Done when: both notes show\n- Tested: `npx vitest related`\n\nMore lines\n\nAnd more'
  const fixed = { id: 'cut', severity: 'major' as const, title: 'Button cut on the phone', where: 'app/x.vue:3', proof: 'shot' }
  const c = waiting({
    yourTurn: 'Look at the screenshots, then merge', userLabel: 'Merge',
    state: at(4, { yourTurn: { reason: 'user', badge: 'Look at the screenshots, then merge' }, rounds: { review: 1 }, proofs: { work: { report } },
      reviews: { review: [{ findings: [fixed] }] }, minor: { review: [{ id: 'name', severity: 'minor', title: 'A clearer name' }] } }),
  })
  // Tall content: FoldText folds it (the test DOM has no layout).
  const tall = vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(1000)
  const w = await mountSuspended(TaskSheet, { props: { card: c }, global: { stubs } })
  const worker = w.get('[data-testid="todo-worker-note"]'), review = w.get('[data-testid="todo-review-note"]')
  expect(worker.text()).toContain('Worker\'s note')
  expect(worker.find('strong').text()).toBe('notes') // Markdown
  expect(review.text()).toContain('Review passed, 1 send-back.')
  expect(review.findAll('li').map(li => li.text())).toEqual(['[major] Button cut on the phone (app/x.vue:3)', 'A clearer name'])
  for (const n of [worker, review]) {
    expect(n.find('.msg-fold').classes()).toContain('folded')
    expect(n.get('.msg-fold-btn').text()).toBe('Show more')
  }
  await worker.get('.msg-fold-btn').trigger('click')
  expect(worker.find('.msg-fold').classes()).not.toContain('folded')
  // Full width, stacked; on the phone (CSS) Worker / Reviewer tabs pick the one shown.
  const notes = w.get('[data-testid="todo-notes"]')
  expect(notes.findAll('[role="tab"]').map(t => t.text())).toEqual(['Worker', 'Reviewer'])
  expect(notes.attributes('data-shown')).toBe('worker')
  await notes.get('[data-note="review"]').trigger('click')
  expect(notes.attributes('data-shown')).toBe('review')
  expect(notes.get('[data-note="review"]').attributes('aria-selected')).toBe('true')
  tall.mockRestore()
  w.unmount()
})

// An approved merge, from the task the server keeps: the same on any device and after a reload.
const approvedCard = (step: Partial<StepState>, more: Partial<Task> = {}) => cardOf({
  id: 'WHR-3', project: 'WHR', title: 'Approved', description: '', type: 'visual', state: 'working', createdAt: 1,
  step: at(4, { approved: { by: 'user', at: 1 }, shots: { work: [{ file: 'aaaaaaaaaaaa.png', phase: 'after', at: 1 }] }, ...step }), ...more,
}, plan, [])

it('an approved merge keeps Merge loading with what it waits for, until it merges or fails', async () => {
  // Second in the merge queue, its last try refused by the queue (not the user's): loading, no Try again.
  const queued = approvedCard({ yourTurn: { reason: 'action', badge: 'Merge: merge: checks still running', error: 'merge: checks still running' } }, { queue: 2 })
  for (let reload = 0; reload < 2; reload++) {
    const w = await mountSuspended(TaskSheet, { props: { card: queued }, global: { stubs } })
    expect(w.get('[data-testid="task-todo"]').attributes('data-todo')).toBe('merge')
    expect(w.get('[data-testid="step-user"]').attributes('disabled')).toBeDefined()
    expect(w.get('[data-testid="step-user-waits"]').text()).toBe('Waiting: 2nd in merge queue')
    expect(w.find('[data-testid="task-retry"]').exists()).toBe(false)
    w.unmount()
  }
  // Its machine offline: said under the button.
  const offline = await mountSuspended(TaskSheet, { props: { card: { ...approvedCard({}), held: 'its machine is offline' } }, global: { stubs } })
  expect(offline.get('[data-testid="step-user-waits"]').text()).toBe('Waiting: its machine is offline')
  offline.unmount()
  // Merged: no longer Your turn, no button.
  const merged = await mountSuspended(TaskSheet, { props: { card: approvedCard({ done: true }) }, global: { stubs } })
  expect(merged.find('[data-testid="task-todo"]').exists()).toBe(false)
  expect(merged.find('[data-testid="step-user"]').exists()).toBe(false)
  merged.unmount()
  // Failed, out of the queue: the user's again, Try again enabled with the reason in plain words.
  const failed = await mountSuspended(TaskSheet, { props: { card: approvedCard({ yourTurn: { reason: 'action', badge: 'Merge: merge: 2 check(s) failed', error: 'merge: 2 check(s) failed' } }) }, global: { stubs } })
  expect(failed.get('[data-testid="task-retry"]').attributes('disabled')).toBeUndefined()
  expect(failed.get('[data-testid="task-badge"]').text()).toContain('2 check(s) failed')
  expect(failed.find('[data-testid="step-user-waits"]').exists()).toBe(false)
  failed.unmount()
})

it('links a step\'s commit to the repository of its own PR, not a task-level link to another one', async () => {
  const sha = '0123456789abcdef0123456789abcdef01234567'
  const c: Card = { ...card, yourTurn: undefined, userLabel: undefined, plan: planSteps(wherdr, { type: 'simple' }),
    links: [{ label: 'PR', url: 'https://github.com/example/other/pull/12' }, { label: 'PR', url: 'https://github.com/example/task/pull/34' }],
    state: { ...initialState(), started: true, at: 2, proofs: { work: { commit: sha, link: 'https://github.com/example/task/pull/34' } } } }
  const w = await mountSuspended(TaskSheet, { props: { card: c }, global: { stubs } })
  await w.get('[data-tab="plan"]').trigger('click')
  expect(w.get('[data-proof="commit"] a').attributes('href')).toBe(`https://github.com/example/task/commit/${sha}`)
  w.unmount()
})
