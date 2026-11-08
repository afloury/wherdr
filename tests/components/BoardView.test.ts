import { afterEach, expect, it, vi } from 'vitest'
import { mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import { readBody } from 'h3'
import BoardView from '~/components/BoardView.vue'
import { herdrState } from '~/composables/useHerdr'
import { answerConfirm, confirmState, menuState } from '~/composables/useUi'
import { boardColumns, cardOf, type Board } from '#shared/pm/board'
import { initialState, planSteps, type StepState } from '#shared/pm/steps'
import { company, vibe } from '#shared/pm/examples'
import type { Run, Task } from '#shared/pm/run'
import type { Template } from '#shared/pm/workflow'
import type { Pane } from '#shared/types'
import { pick, selectLabels } from '../helpers/select'

// Cards built by the same code as the server (server/utils/pmBoard.ts).
const run = (task: string, role: Run['role'], terminal: string): Run =>
  ({ id: `${task}-${role}`, task, role, program: 'claude', model: 'm', machine: '', worktree: '/w', branch: 'b', instructions: '/i', terminal, attempt: 1, state: 'running', startedAt: 1 })
const runs = [run('VIB-1', 'worker', 'host-a/t1'), run('CO-1', 'worker', 'host-a/t2'), run('CO-1', 'reviewer', 'host-a/t3')]
const at = (i: number, more: Partial<StepState> = {}): StepState => ({ ...initialState(), started: true, at: i, ...more })
const task = (id: string, step: StepState, more: Partial<Task> = {}): Task => ({ id, project: id.split('-')[0]!, title: `Task ${id}`, description: '', type: 'feature', state: 'working', step, createdAt: 1, ...more })
const columns = (t: Template) => boardColumns(Object.keys(t.taskTypes).map(type => planSteps(t, { type })))
const vibeTask = (id: string, step: StepState) => cardOf({ ...task(id, step), type: 'simple' }, planSteps(vibe, { type: 'simple' }), runs)
const coTask = (t: Task) => cardOf(t, planSteps(company, { type: 'feature' }), runs)

let board: Board
const reset = (co1: Partial<StepState> = {}) => {
  board = {
    projects: [{ key: 'VIB', name: 'Vibe', columns: columns(vibe) }, { key: 'CO', name: 'Company', columns: columns(company) }],
    cards: [
      cardOf(task('VIB-1', at(1), { type: 'simple', tags: ['client'], links: [{ label: 'Ticket', url: 'https://example.com/t/1' }, { label: 'PR', url: 'https://example.com/pr/2' }] }), planSteps(vibe, { type: 'simple' }), runs),
      coTask(task('CO-1', at(2, co1), {
        tags: ['CTP-1', 'client', 'x'], links: [{ label: 'PR', url: 'https://example.com/pr/1' }],
        log: [{ at: 1, by: 'coordinator CO', text: 'review: coordinator chose pass (advice: pass, nothing above minor). Only a naming nit is left.' }],
      })),
      coTask(task('CO-2', at(4, { yourTurn: { reason: 'user', badge: 'Merge the PR' } }))),
    ],
  }
}
reset()
registerEndpoint('/api/pm/board', () => board)
registerEndpoint('/api/pm/coordinators', () => [])
const posts: { url: string, body: Record<string, unknown> }[] = []
for (const url of ['/api/pm/task-stop', '/api/pm/task-resume', '/api/pm/task-remove'])
  registerEndpoint(url, { method: 'POST', handler: async (e) => { posts.push({ url, body: await readBody(e) }); return {} } })
const pane = (coreAddress: string, status: Pane['status']) => ({ id: coreAddress, coreAddress, status, agent: 'claude', workspace: 'w', tab: 't' }) as Pane
herdrState.value = { ok: true, workspaces: [], panes: [pane('host-a/t1', 'working'), pane('host-a/t2', 'idle'), pane('host-a/t3', 'working')] }

let mounted: { unmount: () => void } | null = null
afterEach(() => { mounted?.unmount(); mounted = null; reset() })
const mount = async () => {
  const w = await mountSuspended(BoardView)
  mounted = w
  await vi.waitFor(() => expect(w.findAll('[data-testid="board-card"]')).toHaveLength(3))
  return w
}
const lanes = (w: Awaited<ReturnType<typeof mount>>) => w.findAll('[data-testid="board-lane"]').map(l => l.attributes('data-lane'))
const card = (w: Awaited<ReturnType<typeof mount>>, id: string) => w.find(`[data-task="${id}"]`)
const laneOf = (w: Awaited<ReturnType<typeof mount>>, id: string) => card(w, id).element.closest('[data-lane]')!.getAttribute('data-lane')

it('shows the columns of a template without review, and of all projects', async () => {
  const w = await mount()
  expect(lanes(w)).toEqual(['your-turn', 'todo', 'working', 'done'])
  expect(w.find('[data-testid="alfred"]').exists()).toBe(false) // no bar above the columns: Alfred is behind the header button
  await pick(w, 'board-project', 'VIB')
  expect(lanes(w)).toEqual(['your-turn', 'To do', 'Working', 'Done'])
  expect(laneOf(w, 'VIB-1')).toBe('Working')
  await pick(w, 'board-project', 'CO')
  expect(lanes(w)).toEqual(['your-turn', 'To do', 'Working', 'Review', 'Deploy', 'Done'])
})

it('shows the reviewer\'s state in review, and no indicator on a holder: none card', async () => {
  const w = await mount()
  const review = card(w, 'CO-1').find('[data-testid="holder-state"]')
  expect(review.attributes('aria-label')).toBe('Reviewer: Working')
  expect(review.classes()).toContain('working')
  expect(card(w, 'CO-1').text()).toContain('CTP-1')
  expect(card(w, 'CO-1').text()).toContain('+1')
  expect(card(w, 'CO-1').find('a').attributes('href')).toBe('https://example.com/pr/1')
  // Waiting for a merge by hand: no agent, no indicator, in Your turn with its badge and step.
  expect(card(w, 'CO-2').find('[data-testid="holder-state"]').exists()).toBe(false)
  expect(laneOf(w, 'CO-2')).toBe('your-turn')
  expect(card(w, 'CO-2').text()).toContain('Merge the PR')
  expect(card(w, 'CO-2').text()).toContain('merge')
})

it('moves a card to Your turn when its agent waits for the user', async () => {
  const before = herdrState.value
  herdrState.value = { ...before, panes: before.panes.map(p => (p.coreAddress === 'host-a/t1' ? { ...p, status: 'blocked' as const } : p)) }
  try {
    const w = await mount()
    expect(laneOf(w, 'VIB-1')).toBe('your-turn')
    expect(card(w, 'VIB-1').text()).toContain('Answer the agent')
    expect(card(w, 'VIB-1').find('[data-testid="holder-state"]').classes()).toContain('blocked')
  } finally { herdrState.value = before }
})

it('moves a card to Your turn whatever its step, and keeps its step and indicator', async () => {
  reset({ yourTurn: { reason: 'timeout', badge: 'Check review: over 90m' } })
  const w = await mount()
  await pick(w, 'board-project', 'CO')
  expect(laneOf(w, 'CO-1')).toBe('your-turn')
  expect(card(w, 'CO-1').text()).toContain('review')
  expect(card(w, 'CO-1').find('[data-testid="holder-state"]').exists()).toBe(true)
  expect(w.find('[data-lane="Review"]').findAll('[data-testid="board-card"]')).toHaveLength(0)
})

it('filters the board by tag, and the card\'s one-tap link is its PR', async () => {
  const w = await mount()
  expect(card(w, 'VIB-1').find('[data-testid="board-link"]').attributes('href')).toBe('https://example.com/pr/2')
  expect(selectLabels(w, 'board-tag')).toEqual(['Tags', 'CTP-1', 'client', 'x'])
  await pick(w, 'board-tag', 'client')
  expect(w.findAll('[data-testid="board-card"]').map(c => c.attributes('data-task'))).toEqual(['VIB-1', 'CO-1'])
  await pick(w, 'board-tag', 'x')
  expect(w.findAll('[data-testid="board-card"]').map(c => c.attributes('data-task'))).toEqual(['CO-1'])
})

it('splits the task\'s sheet in tabs, Description first, one open at a time; the log holds the coordinator\'s choice', async () => {
  const w = await mount()
  await card(w, 'CO-1').trigger('click')
  const q = (sel: string) => document.querySelector<HTMLElement>(sel)
  const tabs = () => [...document.querySelectorAll<HTMLElement>('[role="tab"]')].map(t => `${t.dataset.tab}${t.getAttribute('aria-selected') === 'true' ? '*' : ''}`)
  await vi.waitFor(() => expect(tabs()).toEqual(['description*', 'plan', 'log']))
  expect(q('[data-testid="task-panel"] a[href="https://example.com/pr/1"]')).not.toBeNull()
  expect(q('[data-testid="task-plan"]')).toBeNull()
  q('[data-tab="log"]')!.click()
  await vi.waitFor(() => expect(tabs()).toEqual(['description', 'plan', 'log*']))
  expect(q('[data-testid="task-log"]')!.textContent).toContain('coordinator CO')
  expect(q('[data-testid="task-log"]')!.textContent).toContain('chose pass (advice: pass, nothing above minor). Only a naming nit is left.')
  expect(q('[data-testid="task-panel"] a[href="https://example.com/pr/1"]')).toBeNull()
  q('[data-tab="plan"]')!.click()
  await vi.waitFor(() => expect(q('[data-testid="task-plan"] [aria-current="step"]')).not.toBeNull())
  expect(q('[data-testid="task-stop"]')).not.toBeNull() // the actions stay above the tabs
})

it('stops a task from its sheet, after a confirmation with its reason', async () => {
  posts.length = 0
  const w = await mount()
  await card(w, 'VIB-1').trigger('click')
  const q = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`)
  await vi.waitFor(() => expect(q('task-stop')).not.toBeNull())
  q('task-stop')!.click()
  await vi.waitFor(() => expect(q('task-stop-confirm')?.textContent).toContain('nothing is merged'))
  const why = q('task-stop-why')!.querySelector('input') ?? q('task-stop-why') as HTMLInputElement
  ;(why as HTMLInputElement).value = 'it loops'
  why.dispatchEvent(new Event('input'))
  q('task-stop-yes')!.click()
  await vi.waitFor(() => expect(posts).toEqual([{ url: '/api/pm/task-stop', body: { id: 'VIB-1', why: 'it loops' } }]))
  expect(card(w, 'VIB-1').element.parentElement!.querySelector('[data-testid="card-menu"]')).not.toBeNull()
})

it('a stopped card waits in Your turn with who stopped it; its sheet offers Continue, Take it as it is, Archive', async () => {
  posts.length = 0
  const stopped = { by: 'the user', why: 'it loops', at: 3 }
  board.cards[0] = cardOf(task('VIB-1', at(1), { type: 'simple', state: 'waiting', waiting: 'Stopped by the user: it loops', stopped }), planSteps(vibe, { type: 'simple' }), [])
  const w = await mount()
  expect(laneOf(w, 'VIB-1')).toBe('your-turn')
  expect(card(w, 'VIB-1').text()).toContain('Stopped by the user: it loops')
  expect(card(w, 'VIB-1').find('[data-testid="holder-state"]').exists()).toBe(true)
  await card(w, 'VIB-1').trigger('click')
  await vi.waitFor(() => expect(document.querySelectorAll('[data-resume]')).toHaveLength(3))
  expect(document.querySelector('[data-testid="task-stop"]')).toBeNull()
  expect([...document.querySelectorAll('[data-resume]')].map(b => b.textContent!.trim())).toEqual(['Continue', 'Take it as it is', 'Archive'])
  document.querySelector<HTMLElement>('[data-resume="continue"]')!.click()
  await vi.waitFor(() => expect(posts).toEqual([{ url: '/api/pm/task-resume', body: { id: 'VIB-1', how: 'continue' } }]))
})

it('a task never started offers Delete… in its menu, confirmed first; a started one does not', async () => {
  posts.length = 0
  board.cards[0] = cardOf(task('VIB-1', initialState(), { type: 'simple', state: 'todo' }), planSteps(vibe, { type: 'simple' }), [])
  const w = await mount()
  const menu = async (id: string) => { await card(w, id).element.parentElement!.querySelector<HTMLElement>('[data-testid="card-menu"]')!.click(); return menuState.items.map(i => ('label' in i ? i.label : '')) }
  expect(await menu('CO-1')).not.toContain('Delete…')
  expect(await menu('VIB-1')).toEqual(['Open', 'Delete…'])
  const del = menuState.items.find(i => 'label' in i && i.label === 'Delete…')!
  expect(del).toMatchObject({ danger: true })
  ;(del as { run: () => void }).run()
  await vi.waitFor(() => expect(confirmState.open).toBe(true))
  expect(confirmState.message).toContain('It never started')
  answerConfirm(true)
  await vi.waitFor(() => expect(posts).toEqual([{ url: '/api/pm/task-remove', body: { id: 'VIB-1' } }]))
})

it('the card menu opens on long press and right click; its ••• button only when it has more than Open', async () => {
  board.cards[0] = cardOf(task('VIB-1', { ...initialState(), started: true, done: true }, { type: 'simple', state: 'done' }), planSteps(vibe, { type: 'simple' }), runs)
  const w = await mount()
  const dots = (id: string) => card(w, id).element.parentElement!.querySelector('[data-testid="card-menu"]')
  expect(dots('VIB-1')).toBeNull()
  expect(dots('CO-1')).not.toBeNull()
  // A still long press with a finger: the sheet, and the lifted finger does not open the task.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  try {
    await card(w, 'VIB-1').trigger('pointerdown', { pointerType: 'touch', button: 0, clientX: 0, clientY: 0 })
    vi.advanceTimersByTime(720)
    await card(w, 'VIB-1').trigger('pointerup')
    await card(w, 'VIB-1').trigger('click')
  } finally { vi.useRealTimers() }
  expect(menuState.open).toBe(true)
  expect(menuState.items.map(i => ('label' in i ? i.label : ''))).toEqual(['Open'])
  expect(document.querySelector('[data-testid="task-stop"], [data-testid="task-log"]')).toBeNull()
  menuState.open = false
  // A mouse right click on a touch or narrow screen: the same sheet.
  await card(w, 'CO-1').trigger('pointerdown', { pointerType: 'mouse', button: 2 })
  await card(w, 'CO-1').trigger('contextmenu')
  expect(menuState.open).toBe(true)
  expect(menuState.items.map(i => ('label' in i ? i.label : ''))).toContain('Stop…')
  menuState.open = false
})
