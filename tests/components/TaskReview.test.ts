// The To review block of a task waiting for the user: the links, the files and the
// screenshots it names as one-tap rows, the files looked for in one request, a file
// as a plain link the OS opens (or a download), and the screenshots in the image viewer, nothing at all
// when there is nothing to show; and where the task sheet's To do puts it.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, type VueWrapper } from '@vue/test-utils'
import { createError, readBody } from 'h3'
import { mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import TaskReview from '~/components/TaskReview.vue'
import TaskTodo from '~/components/TaskTodo.vue'
import { lightboxSet, lightboxSrc } from '~/composables/useUi'
import { initialState } from '#shared/pm/steps'
import type { Card } from '#shared/pm/board'

type Where = { root: 'worktree' | 'task', rel: string }
// The task's machine: the files it has (by path as written), what was asked, how it answers.
let there: Record<string, Where> = {}
let hold: Promise<void> | null = null
let offline = false
const asked: { task: string, paths: string[] }[] = []
registerEndpoint('/api/pm/task-files', { method: 'POST', handler: async (e) => {
  const body = await readBody(e) as { task: string, paths: string[] }
  asked.push(body)
  if (hold) await hold
  if (offline) throw createError({ statusCode: 502, statusMessage: 'The machine is offline' })
  return { found: Object.fromEntries(body.paths.filter(p => Object.hasOwn(there, p)).map(p => [p, there[p]])) }
} })
// Whether the browser is on the task's computer (GET /api/pm/task-file-open), the OS-open asks, and whether it works.
let thisComputer = false
let openFails = false
const opened: unknown[] = []
registerEndpoint('/api/pm/task-file-open', { method: 'GET', handler: () => ({ available: thisComputer }) })
registerEndpoint('/api/pm/task-file-open', { method: 'POST', handler: async (e) => {
  if (openFails) throw createError({ statusCode: 400, statusMessage: 'No application' })
  opened.push(await readBody(e))
  return { ok: true }
} })

// A user step on its way to Approve: it names catalogue.md in its badge, docs/guide.md in its instructions.
const plan = [
  { id: 'work', column: 'Working', holder: 'worker', ends: 'report', text: '', screenshots: 'before-after' },
  { id: 'approve', column: 'Review', ends: 'user', userLabel: 'Approve', badge: 'Read catalogue.md, then approve', instructions: 'Also see docs/guide.md', text: '' },
] as Card['plan']
const PR = 'https://git.example.test/acme/web/pull/43'
const card = (over: Partial<Card> = {}): Card => ({
  id: 'WHR-1', shown: 'WHR-1', project: 'WHR', title: 'A task', description: '', column: 'Review', phase: 'your-turn', holder: 'user', tags: [], links: [], log: [],
  plan, yourTurn: 'Read catalogue.md, then approve', userLabel: 'Approve',
  state: { ...initialState(), started: true, at: 1, yourTurn: { reason: 'user', badge: 'Read catalogue.md, then approve' } },
  ...over,
})
const ROWS = '[data-testid="task-review-row"]'
const rows = (w: VueWrapper) => w.findAll(ROWS).map(r => [r.attributes('data-kind'), r.find('.review-label').text()])
const catalogue: Where = { root: 'worktree', rel: 'catalogue.md' }

beforeEach(() => { there = {}; hold = null; offline = false; asked.length = 0; opened.length = 0; thisComputer = false; openFails = false; lightboxSrc.value = null; lightboxSet.value = [] })

describe('To review', () => {
  it('lists what the step, the latest report and the task name, most relevant first, and only the files that exist, in one request', async () => {
    there = { 'catalogue.md': catalogue, 'docs/guide.md': { root: 'task', rel: 'docs/guide.md' }, 'plan.md': { root: 'worktree', rel: 'plan.md' } }
    const w = await mountSuspended(TaskReview, { props: { card: card({
      workReports: [{ step: 'work', text: 'Superseded by the next: old.md' }, { step: 'work', text: 'Wrote `catalogue.md`, plan.md and gone.md. Preview: https://preview.example.test/home' }],
      links: [{ label: 'PR', url: PR }],
    }) } })
    await vi.waitFor(() => expect(w.findAll('[data-testid="task-review-pending"]')).toHaveLength(0))
    // One POST for every file the texts name, the step's first, none of an older report.
    expect(asked).toEqual([{ task: 'WHR-1', paths: ['catalogue.md', 'docs/guide.md', 'plan.md', 'gone.md'] }])
    expect(rows(w)).toEqual([['file', 'catalogue.md'], ['file', 'guide.md'], ['file', 'plan.md'], ['url', 'preview.example.test/home'], ['url', 'PR #43']])
    // Every row but the screenshots is a plain link: a page opens in a new tab, a file is its download.
    const links = w.findAll(`a${ROWS}`)
    expect(links.map(a => [a.attributes('href'), a.attributes('target'), a.attributes('rel')])).toEqual([
      ['/api/files/download?task=WHR-1&in=worktree&path=catalogue.md', '_blank', 'noopener'],
      ['/api/files/download?task=WHR-1&in=task&path=docs%2Fguide.md', '_blank', 'noopener'],
      ['/api/files/download?task=WHR-1&in=worktree&path=plan.md', '_blank', 'noopener'],
      ['https://preview.example.test/home', '_blank', 'noopener'], [PR, '_blank', 'noopener'],
    ])
    expect(w.findAll(`button${ROWS}`)).toHaveLength(0)
    // Where it comes from, muted: the step or the report; the host of a link.
    expect(w.findAll(ROWS).map(r => r.find('.review-meta').exists() && r.find('.review-meta').text())).toEqual(['Step', 'Step', 'Report', false, 'git.example.test'])
    w.unmount()
  })

  it('falls back on the worker\'s closing note when no report was kept', async () => {
    there = { 'plan.md': { root: 'worktree', rel: 'plan.md' } }
    const w = await mountSuspended(TaskReview, { props: { card: card({ yourTurn: undefined, state: { ...initialState(), started: true, at: 1, proofs: { work: { report: 'The plan is in plan.md.' } } } }) } })
    await vi.waitFor(() => expect(rows(w)).toEqual([['file', 'plan.md']]))
    w.unmount()
  })

  it('shows the links at once and a skeleton for each file while the server is asked', async () => {
    const gate = Promise.withResolvers<void>()
    hold = gate.promise
    there = { 'catalogue.md': catalogue, 'docs/guide.md': { root: 'task', rel: 'docs/guide.md' } }
    const w = await mountSuspended(TaskReview, { props: { card: card({ links: [{ label: 'PR', url: PR }] }) } })
    await flushPromises()
    expect(w.findAll('[data-testid="task-review-pending"]')).toHaveLength(2)
    expect(w.find('[data-testid="task-review-pending"]').attributes('aria-busy')).toBe('true')
    expect(rows(w)).toEqual([['url', 'PR #43']])
    gate.resolve()
    await vi.waitFor(() => expect(w.findAll('[data-testid="task-review-pending"]')).toHaveLength(0))
    expect(rows(w)).toEqual([['file', 'catalogue.md'], ['file', 'guide.md'], ['url', 'PR #43']])
    w.unmount()
  })

  it('is not there when nothing is named, or when none of the files exists', async () => {
    const none = await mountSuspended(TaskReview, { props: { card: card({ yourTurn: 'Deploy it', plan: [{ id: 'deploy', ends: 'user', userLabel: 'Deployed', text: '' }] as Card['plan'] }) } })
    await flushPromises()
    expect(none.find('[data-testid="task-review"]').exists()).toBe(false)
    expect(asked).toEqual([])
    none.unmount()
    const gone = await mountSuspended(TaskReview, { props: { card: card() } })
    await vi.waitFor(() => expect(asked).toHaveLength(1))
    await flushPromises()
    expect(gone.find('[data-testid="task-review"]').exists()).toBe(false)
    gone.unmount()
  })

  it('drops the files when the machine cannot be asked, says so, and asks again on Try again', async () => {
    offline = true
    there = { 'catalogue.md': catalogue }
    const w = await mountSuspended(TaskReview, { props: { card: card({ links: [{ label: 'PR', url: PR }] }) } })
    await vi.waitFor(() => expect(w.find('[data-testid="task-review-failed"]').exists()).toBe(true))
    expect(rows(w)).toEqual([['url', 'PR #43']])
    expect(w.findAll('[data-testid="task-review-pending"]')).toHaveLength(0)
    offline = false
    await w.get('[data-testid="task-review-retry"]').trigger('click')
    await vi.waitFor(() => expect(rows(w)).toEqual([['file', 'catalogue.md'], ['url', 'PR #43']]))
    expect(w.find('[data-testid="task-review-failed"]').exists()).toBe(false)
    expect(asked).toHaveLength(2)
    w.unmount()
  })

  it('asks again only when the task or the paths change, not at each refresh of the board', async () => {
    there = { 'catalogue.md': catalogue, 'plan.md': { root: 'worktree', rel: 'plan.md' } }
    const w = await mountSuspended(TaskReview, { props: { card: card() } })
    await vi.waitFor(() => expect(rows(w)).toEqual([['file', 'catalogue.md']]))
    // A refresh: a new card of the same files.
    await w.setProps({ card: card({ title: 'Renamed', links: [{ label: 'PR', url: PR }] }) })
    await flushPromises()
    expect(rows(w)).toEqual([['file', 'catalogue.md'], ['url', 'PR #43']])
    expect(asked).toHaveLength(1)
    // The worker reports again, naming another file.
    await w.setProps({ card: card({ workReports: [{ step: 'work', text: 'Also plan.md' }] }) })
    await vi.waitFor(() => expect(rows(w)).toEqual([['file', 'catalogue.md'], ['file', 'plan.md']]))
    expect(asked.map(a => a.paths)).toEqual([['catalogue.md', 'docs/guide.md'], ['catalogue.md', 'docs/guide.md', 'plan.md']])
    // Another task: its own request, and never the answer for the first.
    await w.setProps({ card: card({ id: 'WHR-2' }) })
    await vi.waitFor(() => expect(asked).toHaveLength(3))
    expect(asked[2]!.task).toBe('WHR-2')
    w.unmount()
  })

  it('a file is a plain link to its download, in the folder it was found in', async () => {
    there = { 'catalogue.md': catalogue, 'docs/guide.md': { root: 'task', rel: 'docs/guide.md' } }
    const w = await mountSuspended(TaskReview, { props: { card: card() } })
    await vi.waitFor(() => expect(rows(w)).toHaveLength(2))
    const links = w.findAll(ROWS)
    expect(links.map(l => [l.element.tagName, l.attributes('href')])).toEqual([
      ['A', '/api/files/download?task=WHR-1&in=worktree&path=catalogue.md'],
      ['A', '/api/files/download?task=WHR-1&in=task&path=docs%2Fguide.md'],
    ])
    // Never our own viewer.
    await links[0]!.trigger('click')
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    w.unmount()
  })

  it('on the task\'s computer a tap asks the server to open the file with the OS, and does not follow the link', async () => {
    there = { 'catalogue.md': catalogue }
    thisComputer = true
    const w = await mountSuspended(TaskReview, { props: { card: card() } })
    await vi.waitFor(() => expect(rows(w)).toHaveLength(1))
    await flushPromises()
    const click = new MouseEvent('click', { bubbles: true, cancelable: true })
    w.get(ROWS).element.dispatchEvent(click)
    expect(click.defaultPrevented).toBe(true)
    await vi.waitFor(() => expect(opened).toEqual([{ task: 'WHR-1', root: 'worktree', rel: 'catalogue.md' }]))
    w.unmount()
  })

  it('when the OS cannot open it, the same tap downloads the file', async () => {
    there = { 'catalogue.md': catalogue }
    thisComputer = true
    openFails = true
    const win = vi.spyOn(window, 'open').mockReturnValue(null)
    const w = await mountSuspended(TaskReview, { props: { card: card() } })
    await vi.waitFor(() => expect(rows(w)).toHaveLength(1))
    await w.get(ROWS).trigger('click')
    await vi.waitFor(() => expect(win).toHaveBeenCalledWith('/api/files/download?task=WHR-1&in=worktree&path=catalogue.md', '_blank', 'noopener'))
    win.mockRestore()
    w.unmount()
  })

  it('opens the screenshots in the image viewer, on the set the gallery shows', async () => {
    const shots = [{ file: 'aaaaaaaaaaaa.png', phase: 'before' as const, at: 1 }, { file: 'bbbbbbbbbbbb.png', phase: 'after' as const, at: 2 }]
    const c = card({ yourTurn: 'Look at them', state: { ...initialState(), started: true, at: 1, shots: { work: shots } } })
    const w = await mountSuspended(TaskReview, { props: { card: c } })
    await flushPromises()
    expect(rows(w)).toEqual([['shots', 'Screenshots (2)']])
    await w.get('[data-kind="shots"]').trigger('click')
    expect(lightboxSet.value).toEqual(['/api/pm/shot?task=WHR-1&file=aaaaaaaaaaaa.png', '/api/pm/shot?task=WHR-1&file=bbbbbbbbbbbb.png'])
    expect(lightboxSrc.value).toBe(lightboxSet.value[0])
    w.unmount()
  })

  it('folds a long list behind Show more, but never to hide a single row', async () => {
    const links = (n: number) => Array.from({ length: n }, (_, i) => ({ label: `L${i}`, url: `https://example.test/p${i}` }))
    const w = await mountSuspended(TaskReview, { props: { card: card({ yourTurn: undefined, plan: [], links: links(6) }) } })
    expect(w.findAll(ROWS)).toHaveLength(6)
    expect(w.find('[data-testid="task-review-more"]').exists()).toBe(false)
    await w.setProps({ card: card({ yourTurn: undefined, plan: [], links: links(9) }) })
    expect(w.findAll(ROWS)).toHaveLength(5)
    const more = w.get('[data-testid="task-review-more"]')
    expect([more.text(), more.attributes('aria-expanded')]).toEqual(['Show 4 more', 'false'])
    await more.trigger('click')
    expect(w.findAll(ROWS)).toHaveLength(9)
    expect([more.text(), more.attributes('aria-expanded')]).toEqual(['Show less', 'true'])
    await more.trigger('click')
    expect(w.findAll(ROWS)).toHaveLength(5)
    w.unmount()
  })
})

// The task sheet's To do and Tasks to review (TaskTodo): under the step's line and the TL;DR.
describe('To review in the To do tab', () => {
  const todo = (kind: string, over: Partial<Card> = {}) => mountSuspended(TaskTodo, {
    props: { card: card({ links: [{ label: 'PR', url: PR }], tldr: 'What it changes.', ...over }), kind: kind as never, busy: false, pressing: false, refused: '' },
  })
  const holding = { holder: 'coordinator' as const, log: [], state: { ...initialState(), started: true, at: 1, since: 1, waitUser: 2 } }
  it.each([
    ['merge', {}], ['step', {}], ['blocked', { state: undefined }], ['review', {}], ['coordinator', holding],
    ['ask', { asks: { kind: 'question' as const, text: 'Which port?' } }],
  ])('a %s step shows it right after the step\'s line', async (kind, over) => {
    const w = await todo(kind, over)
    const block = w.get('[data-testid="task-review"]').element
    const say = w.get('[data-testid="task-badge"]').element
    expect(say.compareDocumentPosition(block) & Node.DOCUMENT_POSITION_FOLLOWING, 'after the step\'s line').toBeTruthy()
    const tldr = w.find('[data-testid="todo-tldr"]')
    if (tldr.exists()) expect(tldr.element.compareDocumentPosition(block) & Node.DOCUMENT_POSITION_FOLLOWING, 'below the TL;DR').toBeTruthy()
    const buttons = w.get('.todo-actions').element
    expect(block.compareDocumentPosition(buttons) & Node.DOCUMENT_POSITION_FOLLOWING, 'before the buttons').toBeTruthy()
    w.unmount()
  })

  it.each([
    ['stopped', { stopped: { by: 'the user', why: 'wrong way', at: 1 }, yourTurn: 'Stopped by the user: wrong way' }],
    ['decide', { state: { ...initialState(), started: true, at: 1, yourTurn: { reason: 'rounds' as const, badge: 'Decide', advice: { outcome: 'round' as const, why: 'New finding', options: ['round', 'split'], findings: [] } } } }],
  ])('a %s has none', async (kind, over) => {
    const w = await todo(kind, over)
    expect(w.find('[data-testid="task-review"]').exists()).toBe(false)
    w.unmount()
  })
})
