import { describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { mockNuxtImport, mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import TaskSheet from '~/components/TaskSheet.vue'
import type { TaskRow } from '#shared/projectsTasks'

mockNuxtImport('askConfirm', () => async () => true)

// Each action's reply is held until the test lets it go.
const held: Array<() => void> = []
function hold() { return new Promise(resolve => { held.push(() => resolve({ ok: true, msg: 'done' })) }) }
registerEndpoint('/api/tasks/approve', { method: 'POST', handler: hold })
registerEndpoint('/api/tasks/action', { method: 'POST', handler: hold })
// What the details say, and how many times they were read.
const shown: { stage: string, failure: string, failureStage: string, archived?: boolean, pane?: string | null } = { stage: 'approval', failure: '', failureStage: '' }
let detailsReads = 0
registerEndpoint('/api/tasks/details', () => {
  detailsReads++
  return { id: 'demo/1', title: 'Fix login', msg: '', description: '', agent: 'claude', pr: '', branch: '', worktree: '', failureAuth: false, pane: null as string | null, ...shown }
})

const task: TaskRow = {
  id: 'demo/1', repo: 'demo', n: 1, state: 'blocked', kind: '', stage: 'approval', title: 'Fix login', msg: '', app: 'claude',
  progress: null, eta: null, pr: '', review: null, reviewRound: 0, research: false, archived: false, queue: null, group: 'needs',
}

interface SheetVm { busy: boolean, approve: () => Promise<void>, act: (a: string) => Promise<void> }
async function sheet() {
  const w = await mountSuspended(TaskSheet, { props: { task, machine: 'a', open: true, 'onUpdate:open': (v: boolean) => w.setProps({ open: v }) } })
  await flushPromises()
  return { w, vm: w.vm as unknown as SheetVm }
}
// A sent, held → the same task on machine B → A's reply.
async function lateReply(start: (vm: SheetVm) => Promise<void>) {
  const { w, vm } = await sheet()
  const done = start(vm)
  await flushPromises()
  expect(held).toHaveLength(1)
  await w.setProps({ machine: 'b' })
  await flushPromises()
  held.shift()!()
  await done
  await flushPromises()
  return { w, vm }
}

describe('the task sheet after a late reply', () => {
  it('Approve for A does not close the sheet of B', async () => {
    const { w, vm } = await lateReply(vm => vm.approve())
    expect(w.props('open')).toBe(true)
    expect(vm.busy).toBe(false)
    w.unmount()
  })

  it('Archive for A does not close the sheet of B', async () => {
    const { w } = await lateReply(vm => vm.act('archive'))
    expect(w.props('open')).toBe(true)
    w.unmount()
  })

  it('B is not kept busy by A\'s request', async () => {
    const { w, vm } = await sheet()
    const done = vm.approve()
    await flushPromises()
    await w.setProps({ machine: 'b' })
    await flushPromises()
    expect(vm.busy).toBe(false)
    held.shift()!()
    await done
    w.unmount()
  })

  it('closed and opened again on A during the request: the sheet stays open, not busy', async () => {
    const { w, vm } = await sheet()
    const done = vm.approve()
    await flushPromises()
    await w.setProps({ open: false })
    await w.setProps({ open: true })
    await flushPromises()
    held.shift()!()
    await done
    await flushPromises()
    expect(w.props('open')).toBe(true)
    expect(vm.busy).toBe(false)
    w.unmount()
  })

  it('stays open after Approve on its own task', async () => {
    const { w, vm } = await sheet()
    const approved = vm.approve()
    await flushPromises()
    held.shift()!()
    await approved
    await flushPromises()
    expect(w.props('open')).toBe(true)
    w.unmount()
  })
})

describe('the task sheet while its task moves on', () => {
  it('shows Retry when the open task fails, without reopening, and reads its details once more', async () => {
    const working: TaskRow = { ...task, state: 'working', stage: 'working', group: 'working' }
    Object.assign(shown, { stage: 'working', failure: '', failureStage: '' })
    const w = await mountSuspended(TaskSheet, { props: { task: working, machine: 'a', open: true } })
    await flushPromises()
    const vm = w.vm as unknown as { actions: { retry: boolean, stop: boolean } }
    const before = detailsReads
    expect(vm.actions.retry).toBe(false)

    // The agent's turn fails: the next read of the Board gives the same task, failed.
    Object.assign(shown, { stage: 'failed', failure: 'tests failed', failureStage: 'send' })
    await w.setProps({ task: { ...working, state: 'error', stage: 'failed', group: 'needs' } })
    await vi.waitFor(() => expect(vm.actions.retry).toBe(true))
    expect(detailsReads).toBe(before + 1)

    // Another read of the Board, nothing changed: no new read of the details.
    await w.setProps({ task: { ...working, state: 'error', stage: 'failed', group: 'needs' } })
    await flushPromises()
    await new Promise(r => setTimeout(r, 100))
    expect(detailsReads).toBe(before + 1)
    Object.assign(shown, { stage: 'approval', failure: '', failureStage: '' })
    w.unmount()
  })
})

describe('the task sheet of a read-only board (wherdr in a container)', () => {
  it('shows its actions off, each saying why on hover, and the host commands', async () => {
    Object.assign(shown, { stage: 'approval', failure: '', failureStage: '' })
    const w = await mountSuspended(TaskSheet, { props: { task, machine: '', open: true, readOnly: true } })
    await flushPromises()
    const vm = w.vm as unknown as { actions: { approve: boolean, tell: boolean } }
    expect(vm.actions.approve).toBe(false)
    expect(vm.actions.tell).toBe(false)
    await vi.waitFor(() => expect(document.querySelectorAll('.task-sheet-ro .ro-why').length).toBeGreaterThan(0))
    const wraps = [...document.querySelectorAll<HTMLElement>('.task-sheet-ro .ro-why')]
    const labels = wraps.map(s => s.textContent?.trim())
    expect(labels).toEqual(expect.arrayContaining(['Approve', 'Reply']))
    for (const s of wraps) {
      expect(s.title).toMatch(/container/)
      expect(s.querySelector('button')!.disabled).toBe(true)
    }
    expect(document.body.textContent).toContain('herdr-projects approve demo/1')
    w.unmount()
  })
})

describe('the task sheet after an action', () => {
  it('Archive closes the sheet and hands the task to the Board (which offers Restore)', async () => {
    Object.assign(shown, { stage: 'done', failure: '', failureStage: '' })
    const done: TaskRow = { ...task, state: 'done', stage: 'done', group: 'done' }
    const archived: Array<[string, string]> = []
    const w = await mountSuspended(TaskSheet, { props: {
      task: done, machine: 'far', open: true, 'onUpdate:open': (v: boolean) => w.setProps({ open: v }),
      onArchived: (m: string, t: TaskRow) => archived.push([m, t.id]),
    } })
    await flushPromises()
    const vm = w.vm as unknown as SheetVm & { actions: { archive: boolean } }
    expect(vm.actions.archive).toBe(true)
    const going = vm.act('archive')
    await flushPromises()
    held.shift()!()
    await going
    await flushPromises()
    expect(w.props('open')).toBe(false)
    expect(archived).toEqual([['far', 'demo/1']])
    Object.assign(shown, { stage: 'approval' })
    w.unmount()
  })

  it('reads the Board and the task again before its buttons come back, so they match the new state', async () => {
    Object.assign(shown, { stage: 'todo', failure: '', failureStage: '' })
    const todo: TaskRow = { ...task, state: 'idle', stage: 'todo', group: 'todo', app: '' }
    let release: () => void = () => {}
    const refresh = vi.fn(() => new Promise<void>((r) => { release = r }))
    const w = await mountSuspended(TaskSheet, { props: { task: todo, machine: 'a', open: true, refresh } })
    await flushPromises()
    const vm = w.vm as unknown as SheetVm & { actions: { delegate: boolean, stop: boolean } }
    const before = detailsReads
    const going = vm.act('delegate')
    await flushPromises()
    held.shift()!()
    await flushPromises()
    // Started, the Board not read yet: still busy, Start not offered again.
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledOnce())
    expect(vm.busy).toBe(true)
    // The Board's read: the task is at work; its details are read again.
    Object.assign(shown, { stage: 'working' })
    await w.setProps({ task: { ...todo, state: 'working', stage: 'working', group: 'working', app: 'claude' } })
    release()
    await going
    await flushPromises()
    expect(vm.busy).toBe(false)
    expect(detailsReads).toBeGreaterThan(before)
    expect(vm.actions.delegate).toBe(false)
    expect(vm.actions.stop).toBe(true)
    Object.assign(shown, { stage: 'approval' })
    w.unmount()
  })

  it('Approve keeps the sheet open and shows the new state once the Board and the task are read again', async () => {
    Object.assign(shown, { stage: 'plan', failure: '', failureStage: '' })
    const plan: TaskRow = { ...task, state: 'blocked', kind: 'permission', stage: 'plan', group: 'needs' }
    let release: () => void = () => {}
    const refresh = vi.fn(() => new Promise<void>((r) => { release = r }))
    const w = await mountSuspended(TaskSheet, { props: { task: plan, machine: 'a', open: true, refresh, 'onUpdate:open': (v: boolean) => w.setProps({ open: v }) } })
    await flushPromises()
    const vm = w.vm as unknown as SheetVm & { actions: { approve: boolean, stop: boolean } }
    expect(vm.actions.approve).toBe(true)
    const before = detailsReads
    const going = vm.approve()
    await flushPromises()
    held.shift()!()
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledOnce())
    // Approved, the Board not read yet: open and busy, Approve not offered again meanwhile.
    expect(w.props('open')).toBe(true)
    expect(vm.busy).toBe(true)
    // The Board's read: its agent builds the plan.
    Object.assign(shown, { stage: 'working' })
    await w.setProps({ task: { ...plan, state: 'working', kind: '', stage: 'working', group: 'working' } })
    release()
    await going
    await flushPromises()
    expect(w.props('open')).toBe(true)
    expect(vm.busy).toBe(false)
    expect(detailsReads).toBeGreaterThan(before)
    expect(vm.actions.approve).toBe(false)
    expect(vm.actions.stop).toBe(true)
    Object.assign(shown, { stage: 'approval' })
    w.unmount()
  })

  it('a refused action: its error stays in the sheet', async () => {
    registerEndpoint('/api/tasks/action', { method: 'POST', handler: () => { throw createError({ statusCode: 400, data: { error: 'demo/1 is still active' } }) } })
    const done: TaskRow = { ...task, state: 'done', stage: 'done', group: 'done' }
    const w = await mountSuspended(TaskSheet, { props: { task: done, machine: 'a', open: true } })
    await flushPromises()
    await (w.vm as unknown as SheetVm).act('archive')
    await flushPromises()
    expect(w.props('open')).toBe(true)
    await vi.waitFor(() => expect(document.querySelector('.task-sheet-error')?.textContent).toBeTruthy())
    registerEndpoint('/api/tasks/action', { method: 'POST', handler: hold })
    w.unmount()
  })
})

describe('the sheet of an archived task', () => {
  it('says Archived, offers Restore only (read-only, as in herdr-projects), then shows Archive once restored', async () => {
    Object.assign(shown, { stage: 'done', failure: '', failureStage: '', archived: true })
    const away: TaskRow = { ...task, state: 'done', stage: 'done', group: 'done', archived: true }
    const restored: string[] = []
    const w = await mountSuspended(TaskSheet, { props: { task: away, machine: 'a', open: true, onRestored: (_m: string, t: TaskRow) => restored.push(t.id) } })
    await flushPromises()
    const vm = w.vm as unknown as SheetVm & { actions: Record<string, boolean> }
    expect(vm.actions).toMatchObject({ restore: true, archive: false, tell: false, approve: false, delegate: false })
    await vi.waitFor(() => expect(document.querySelector('.task-archived')?.textContent).toContain('Archived'))
    const labels = [...document.querySelectorAll('.task-sheet-actions button')].map(b => b.textContent?.trim())
    expect(labels).toEqual(['Restore'])
    expect(document.querySelector('.task-chat')).toBeNull()

    const going = vm.act('restore')
    await flushPromises()
    Object.assign(shown, { archived: false })
    held.shift()!()
    await going
    await flushPromises()
    expect(restored).toEqual(['demo/1'])
    // Its details now say it is back: Archive again, no tag.
    await vi.waitFor(() => expect(vm.actions.archive).toBe(true))
    expect(vm.actions.restore).toBe(false)
    expect(document.querySelector('.task-archived')).toBeNull()
    Object.assign(shown, { stage: 'approval', archived: false })
    w.unmount()
  })
})

describe('the sheet\'s chat button (no message field)', () => {
  const working: TaskRow = { ...task, state: 'working', stage: 'working', group: 'working' }
  const buttons = () => [...document.querySelectorAll<HTMLButtonElement>('.task-sheet-actions button')]
  const chatButton = () => document.querySelector<HTMLButtonElement>('.task-sheet-actions .task-chat')

  it('a task under way: Open the chat and Stop, no text field; the chat closes the sheet and asks for the panel', async () => {
    Object.assign(shown, { stage: 'working', failure: '', failureStage: '', pane: 'p-42' })
    const chats: Array<[string, string]> = []
    const w = await mountSuspended(TaskSheet, { props: {
      task: working, machine: 'far', open: true, 'onUpdate:open': (v: boolean) => w.setProps({ open: v }),
      onChat: (m: string, t: TaskRow) => chats.push([m, t.id]),
    } })
    await vi.waitFor(() => expect(chatButton()?.disabled).toBe(false))
    expect(buttons().map(b => b.textContent?.trim())).toEqual(['Open the chat', 'Stop'])
    expect(document.querySelector('.task-sheet textarea, .task-sheet input, .task-sheet form')).toBeNull()
    chatButton()!.click()
    await flushPromises()
    expect(w.props('open')).toBe(false)
    expect(chats).toEqual([['far', 'demo/1']])
    Object.assign(shown, { stage: 'approval', pane: null })
    w.unmount()
  })

  it('a plan that waits: Approve plan and Open the chat, one chat button only', async () => {
    Object.assign(shown, { stage: 'plan', failure: '', failureStage: '', pane: 'p-7' })
    const plan: TaskRow = { ...task, state: 'blocked', kind: 'permission', stage: 'plan', group: 'needs' }
    const w = await mountSuspended(TaskSheet, { props: { task: plan, machine: 'a', open: true } })
    await vi.waitFor(() => expect(chatButton()?.disabled).toBe(false))
    const labels = buttons().map(b => b.textContent?.trim())
    expect(labels).toEqual(expect.arrayContaining(['Approve plan', 'Open the chat']))
    expect(labels.filter(l => l === 'Open the chat')).toHaveLength(1)
    expect(labels).not.toContain('Open its agent')
    expect(document.querySelector('.task-sheet textarea')).toBeNull()
    Object.assign(shown, { stage: 'approval', pane: null })
    w.unmount()
  })

  it('an agent herdr-projects would take a reply from, but with no pane now: the chat is off and says why', async () => {
    Object.assign(shown, { stage: 'working', failure: '', failureStage: '', pane: null })
    const chats: string[] = []
    const w = await mountSuspended(TaskSheet, { props: { task: working, machine: 'a', open: true, onChat: (_m: string, t: TaskRow) => chats.push(t.id) } })
    await vi.waitFor(() => expect(document.querySelector('.task-sheet-nochat')).not.toBeNull())
    expect(chatButton()!.disabled).toBe(true)
    chatButton()!.click()
    await flushPromises()
    expect(chats).toEqual([])
    expect(w.props('open')).toBe(true)
    Object.assign(shown, { stage: 'approval' })
    w.unmount()
  })

  it('a task of the backlog: no chat until it has an agent', async () => {
    Object.assign(shown, { stage: 'todo', failure: '', failureStage: '', pane: null })
    const todo: TaskRow = { ...task, state: 'idle', stage: 'todo', group: 'todo', app: '' }
    const w = await mountSuspended(TaskSheet, { props: { task: todo, machine: 'a', open: true } })
    await vi.waitFor(() => expect(buttons().map(b => b.textContent?.trim())).toContain('Start'))
    expect(chatButton()).toBeNull()
    Object.assign(shown, { stage: 'approval' })
    w.unmount()
  })
})
