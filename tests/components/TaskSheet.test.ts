import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { readBody, setResponseStatus } from 'h3'
import { mockNuxtImport, mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import TaskSheet from '~/components/TaskSheet.vue'
import type { TaskRow } from '#shared/projectsTasks'
import { hiddenAgents } from '~/composables/useHerdr'

mockNuxtImport('askConfirm', () => async () => true)

// Each action's reply is held until the test lets it go.
const held: Array<() => void> = []
function hold() { return new Promise(resolve => { held.push(() => resolve({ ok: true, msg: 'done' })) }) }
let questionBody: unknown
let questionFails = false
let questionHeld = false
registerEndpoint('/api/tasks/question', { method: 'POST', handler: async (event) => {
  questionBody = await readBody(event)
  if (questionHeld) return hold()
  if (questionFails) throw createError({ statusCode: 502, message: 'Coordinator unavailable' })
  return { ok: true }
} })
registerEndpoint('/api/tasks/approve', { method: 'POST', handler: hold })
registerEndpoint('/api/tasks/action', { method: 'POST', handler: hold })
// What the details say, and how many times they were read.
const shown: { stage: string, failure: string, failureStage: string, archived?: boolean, pane?: string | null } = { stage: 'approval', failure: '', failureStage: '' }
let detailsReads = 0
// Start's agent: the task's default (worker.agent, where it comes from) and the installed ones.
let startReply: unknown = { agent: { value: 'claude', kind: 'claude', place: 'repo', from: 'your entry for demo' }, agents: ['claude', 'codex', 'pi'] }
let startReads = 0
registerEndpoint('/api/tasks/start', () => {
  startReads++
  if (!startReply) throw createError({ statusCode: 502, data: { error: 'herdr-projects did not answer' } })
  return startReply
})
registerEndpoint('/api/tasks/details', () => {
  detailsReads++
  return { id: 'demo/1', title: 'Fix login', msg: '', description: '', agent: 'claude', pr: '', branch: '', worktree: '', failureAuth: false, pane: null as string | null, ...shown }
})

const task: TaskRow = {
  id: 'demo/1', repo: 'demo', n: 1, state: 'blocked', kind: '', stage: 'approval', title: 'Fix login', msg: '', app: 'claude',
  progress: null, eta: null, pr: '', review: null, reviewRound: 0, research: false, archived: false, queue: null, group: 'needs',
}

interface SheetVm { busy: boolean, approve: () => Promise<void>, act: (a: string) => Promise<void> }
async function sheet(embedded = false) {
  const w = await mountSuspended(TaskSheet, { props: { embedded, task, machine: 'a', open: true, 'onUpdate:open': (v: boolean) => w.setProps({ open: v }) } })
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
    expect(buttons().map(b => b.textContent?.trim())).toEqual(['Ask the coordinator', 'Coordinator replies', 'Open the chat', 'Stop'])
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

  it('an agent herdr-projects takes a reply for, with no pane now: the chat still opens the panel (its reply goes through tell there)', async () => {
    Object.assign(shown, { stage: 'working', failure: '', failureStage: '', pane: null })
    const chats: string[] = []
    const w = await mountSuspended(TaskSheet, { props: {
      task: working, machine: 'a', open: true, 'onUpdate:open': (v: boolean) => w.setProps({ open: v }),
      onChat: (_m: string, t: TaskRow) => chats.push(t.id),
    } })
    await vi.waitFor(() => expect(chatButton()?.disabled).toBe(false))
    expect(document.querySelector('.task-sheet textarea')).toBeNull()
    chatButton()!.click()
    await flushPromises()
    expect(chats).toEqual(['demo/1'])
    expect(w.props('open')).toBe(false)
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

describe('Start: the agent it starts with', () => {
  const todo: TaskRow = { ...task, state: 'idle', stage: 'todo', group: 'todo', app: '' }
  const startButton = () => [...document.querySelectorAll<HTMLButtonElement>('.task-sheet-actions button')].find(b => /^Start/.test(b.textContent?.trim() || ''))
  const chips = () => [...document.querySelectorAll<HTMLButtonElement>('.task-start-chip')]
  // The bodies Start sends, answered at once.
  let sent: Record<string, unknown>[] = []
  async function open() {
    sent = []
    registerEndpoint('/api/tasks/action', { method: 'POST', handler: async (e) => { sent.push(await readBody(e)); return { ok: true, msg: 'demo/1: started' } } })
    Object.assign(shown, { stage: 'todo', failure: '', failureStage: '', pane: null })
    const w = await mountSuspended(TaskSheet, { props: { task: todo, machine: 'a', open: true } })
    mounted = w
    await vi.waitFor(() => expect(startButton()).toBeTruthy())
    return w
  }
  let mounted: { unmount: () => void } | null = null
  afterEach(() => {
    registerEndpoint('/api/tasks/action', { method: 'POST', handler: hold })
    Object.assign(shown, { stage: 'approval' })
    startReply = { agent: { value: 'claude', kind: 'claude', place: 'repo', from: 'your entry for demo' }, agents: ['claude', 'codex', 'pi'] }
    mounted?.unmount()
    mounted = null
  })
  const done = (w: { unmount: () => void }) => { mounted = w }
  const names = () => chips().map(c => `${c.querySelector('.task-start-name')?.textContent}${c.querySelector('small') ? ' (default)' : ''}`)

  it('shows the default agent, preselected, and where it comes from; the other installed agents after it', async () => {
    const w = await open()
    await vi.waitFor(() => expect(chips()).toHaveLength(3))
    expect(names()).toEqual(['claude (default)', 'codex', 'pi'])
    expect(chips().map(c => c.getAttribute('aria-checked'))).toEqual(['true', 'false', 'false'])
    expect(document.querySelector('.task-start-from')?.textContent).toBe('Default from your settings for demo')
    await vi.waitFor(() => expect(startButton()!.textContent?.trim()).toBe('Start'))
    done(w)
  })

  it('Start without a change: one click, no agent sent (the task\'s default, exactly as before)', async () => {
    const w = await open()
    await vi.waitFor(() => expect(chips()).toHaveLength(3))
    startButton()!.click()
    await vi.waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0]).toEqual({ machine: 'a', id: 'demo/1', action: 'delegate' })
    done(w)
  })

  it('another agent: sent for this start only, and the sheet says the default stays', async () => {
    const w = await open()
    await vi.waitFor(() => expect(chips()).toHaveLength(3))
    chips()[1]!.click()
    await flushPromises()
    expect(chips().map(c => c.getAttribute('aria-checked'))).toEqual(['false', 'true', 'false'])
    expect(startButton()!.textContent?.trim()).toBe('Start with codex')
    expect(document.body.textContent).toContain('For this start only: the default stays.')
    startButton()!.click()
    await vi.waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0]).toEqual({ machine: 'a', id: 'demo/1', action: 'delegate', agent: 'codex' })
    // Back to the default: nothing sent again.
    chips()[0]!.click()
    await flushPromises()
    await vi.waitFor(() => expect(startButton()!.textContent?.trim()).toBe('Start'))
    done(w)
  })

  it('the choice is per sheet: another task, or the sheet opened again, starts from its default', async () => {
    const w = await open()
    await vi.waitFor(() => expect(chips()).toHaveLength(3))
    chips()[2]!.click()
    await flushPromises()
    expect(startButton()!.textContent?.trim()).toBe('Start with pi')
    await w.setProps({ task: { ...todo, id: 'demo/2', n: 2 } })
    await vi.waitFor(() => expect(chips()).toHaveLength(3))
    expect(startButton()!.textContent?.trim()).toBe('Start')
    expect(chips()[0]!.getAttribute('aria-checked')).toBe('true')
    done(w)
  })

  it('a default model (codex/gpt-5.5) is shown as is; the same agent is not offered twice', async () => {
    startReply = { agent: { value: 'codex/gpt-5.5', kind: 'codex', place: 'builtin', from: 'built in' }, agents: ['claude', 'codex'] }
    const w = await open()
    await vi.waitFor(() => expect(chips()).toHaveLength(2))
    expect(names()).toEqual(['codex/gpt-5.5 (default)', 'claude'])
    expect(document.querySelector('.task-start-from')?.textContent).toBe('herdr-projects’ built-in default')
    done(w)
  })

  it('a default not installed on the task\'s machine: shown, not selectable; Start waits for an installed agent', async () => {
    startReply = { agent: { value: 'gemini', kind: 'gemini', place: 'you', from: 'you' }, agents: ['codex'] }
    const w = await open()
    await vi.waitFor(() => expect(chips()).toHaveLength(2))
    expect(names()).toEqual(['gemini (default)', 'codex'])
    expect(chips()[0]!.disabled).toBe(true)
    expect(chips().map(c => c.getAttribute('aria-checked'))).toEqual(['false', 'false'])
    expect(chips()[0]!.textContent).toContain('not installed')
    expect(document.querySelector('.task-start-missing')?.textContent).toBe('gemini is not installed on this machine: pick another agent to start it.')
    expect(startButton()!.disabled).toBe(true)
    startButton()!.click()
    await flushPromises()
    expect(sent).toEqual([])
    chips()[1]!.click()
    await flushPromises()
    expect(startButton()!.disabled).toBe(false)
    expect(document.querySelector('.task-start-missing')).toBeNull()
    startButton()!.click()
    await vi.waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0]).toEqual({ machine: 'a', id: 'demo/1', action: 'delegate', agent: 'codex' })
    done(w)
  })

  it('the machine\'s agents could not be checked (none found): Start keeps the task\'s default, as before', async () => {
    startReply = { agent: { value: 'claude', kind: 'claude', place: 'builtin', from: 'built in' }, agents: [] }
    const w = await open()
    await vi.waitFor(() => expect(chips()).toHaveLength(1))
    expect(chips()[0]!.disabled).toBe(false)
    expect(chips()[0]!.getAttribute('aria-checked')).toBe('true')
    expect(startButton()!.disabled).toBe(false)
    done(w)
  })

  it('the options cannot be read: Start still starts with the task\'s default', async () => {
    startReply = null
    const before = startReads
    const w = await open()
    await vi.waitFor(() => expect(startReads).toBe(before + 1))
    await flushPromises()
    expect(chips()).toHaveLength(0)
    startButton()!.click()
    await vi.waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0]).toEqual({ machine: 'a', id: 'demo/1', action: 'delegate' })
    done(w)
  })

  it('agents unchecked in Settings › Agents are not offered; an unchecked default stays, marked', async () => {
    hiddenAgents.value = ['codex', 'pi']
    try {
      const w = await open()
      await vi.waitFor(() => expect(chips()).toHaveLength(1))
      expect(names()).toEqual(['claude (default)'])
      done(w)
      w.unmount()
      mounted = null
      hiddenAgents.value = ['claude', 'pi']
      const w2 = await open()
      await vi.waitFor(() => expect(chips()).toHaveLength(2))
      expect(names()).toEqual(['claude (default)', 'codex'])
      expect(chips()[0]!.disabled).toBe(false)
      expect(chips()[0]!.getAttribute('aria-checked')).toBe('true')
      expect(chips()[0]!.querySelector('small')?.textContent).toBe('default · hidden in Settings')
      done(w2)
    } finally { hiddenAgents.value = [] }
  })

  it('a pick unchecked meanwhile falls back to the default', async () => {
    try {
      const w = await open()
      await vi.waitFor(() => expect(chips()).toHaveLength(3))
      chips()[1]!.click()
      await flushPromises()
      expect(startButton()!.textContent?.trim()).toBe('Start with codex')
      hiddenAgents.value = ['codex']
      await flushPromises()
      expect(names()).toEqual(['claude (default)', 'pi'])
      expect(startButton()!.textContent?.trim()).toBe('Start')
      done(w)
    } finally { hiddenAgents.value = [] }
  })

  it('not asked where the sheet offers no Start', async () => {
    Object.assign(shown, { stage: 'approval', failure: '', failureStage: '', pane: null })
    const before = startReads
    const w = await mountSuspended(TaskSheet, { props: { task, machine: 'a', open: true } })
    mounted = w
    await flushPromises()
    expect(startReads).toBe(before)
    expect(document.querySelector('.task-start-agent')).toBeNull()
    w.unmount()
  })
})

describe('Finish, and a failure the task moved on from', () => {
  const stopped: TaskRow = { ...task, state: 'blocked', stage: 'stopped', msg: 'Stopped at its 2h limit', group: 'needs' }
  const buttons = () => [...document.querySelectorAll<HTMLButtonElement>('.task-sheet-actions button')].map(b => b.textContent?.trim())
  let sent: Record<string, unknown>[] = []
  afterEach(() => {
    registerEndpoint('/api/tasks/action', { method: 'POST', handler: hold })
    Object.assign(shown, { stage: 'approval', failure: '', failureStage: '', failureStale: undefined, failureTitle: undefined, failureAt: undefined })
  })

  it('a limit stop: Retry and Finish, what each does, and Finish sends finish', async () => {
    sent = []
    registerEndpoint('/api/tasks/action', { method: 'POST', handler: async (e) => { sent.push(await readBody(e)); return { ok: true, msg: 'demo/1: taking the work as it is' } } })
    Object.assign(shown, { stage: 'stopped', failure: '', failureStage: '' })
    const w = await mountSuspended(TaskSheet, { props: { task: stopped, machine: 'a', open: true } })
    await vi.waitFor(() => expect(buttons()).toEqual(expect.arrayContaining(['Retry', 'Finish'])))
    expect(document.querySelector('.task-finish-why')?.textContent).toContain('the same limit again')
    await (w.vm as unknown as SheetVm).act('finish')
    await flushPromises()
    expect(sent).toEqual([{ machine: 'a', id: 'demo/1', action: 'finish' }])
    w.unmount()
  })

  it('an old failure is shown as history, not as a warning', async () => {
    Object.assign(shown, { stage: 'stopped', failure: 'Review failed: no verdict', failureTitle: 'Review failed', failureStage: 'review', failureStale: true, failureAt: 1_792_500_000_000 })
    const w = await mountSuspended(TaskSheet, { props: { task: stopped, machine: 'a', open: true } })
    await vi.waitFor(() => expect(document.querySelector('.task-sheet-earlier')?.textContent).toContain('Review failed'))
    expect(document.querySelector('.task-sheet-earlier h4')?.textContent).toContain('Earlier failure')
    expect(document.querySelector('.plugin-input-note.warn')).toBeNull()
    w.unmount()
  })
})

describe('Queue and Start after…', () => {
  const todo: TaskRow = { ...task, id: 'demo/1', state: 'idle', stage: 'todo', group: 'todo', app: '', repoKey: 'DEMO' }
  const button = (re: RegExp) => [...document.querySelectorAll<HTMLButtonElement>('.task-sheet-actions button')].find(b => re.test(b.textContent?.trim() || ''))
  const agent = { value: 'claude', kind: 'claude', place: 'repo', from: 'your entry for demo' }
  // The Board as GET /api/tasks gives it: this machine and another one.
  const board = { version: 'v1', machines: [
    { machine: 'a', status: 'ready', version: '1.2.1', tasks: [
      todo,
      { ...task, id: 'demo/37', n: 37, title: 'Login page', state: 'working', stage: 'working', group: 'working', repoKey: 'DEMO' },
      { ...task, id: 'demo/38', n: 38, title: 'Old', state: 'done', stage: 'done', group: 'done', repoKey: 'DEMO' },
    ] },
    { machine: 'b', status: 'ready', version: '1.2.1', tasks: [
      { ...task, id: 'ela/3', repo: 'ela', n: 3, title: 'API endpoint', state: 'working', stage: 'working', group: 'working', repoKey: 'ELA' },
    ] },
  ] }
  let sent: { url: string, body: Record<string, unknown> }[] = []
  let refuse = ''
  let mounted: { unmount: () => void } | null = null
  const record = (url: string) => async (e: Parameters<typeof readBody>[0]) => {
    const body = await readBody(e)
    sent.push({ url, body })
    // As the server says a refusal: its words in `error`.
    if (refuse) { setResponseStatus(e, 400); return { error: refuse, code: 'projects_failed' } }
    return { ok: true, msg: `${url}: done` }
  }
  async function open(row: TaskRow, details: Record<string, unknown> = {}) {
    sent = []
    refuse = ''
    registerEndpoint('/api/tasks/action', { method: 'POST', handler: record('action') })
    registerEndpoint('/api/tasks/after', { method: 'POST', handler: record('after') })
    registerEndpoint('/api/tasks', () => board)
    Object.assign(shown, { stage: row.stage, failure: '', failureStage: '', pane: null, ...details })
    const w = await mountSuspended(TaskSheet, { props: { task: row, machine: 'a', open: true } })
    mounted = w
    await flushPromises()
    return w
  }
  afterEach(() => {
    registerEndpoint('/api/tasks/action', { method: 'POST', handler: hold })
    Object.assign(shown, { stage: 'approval', after: undefined, queue: undefined })
    startReply = { agent, agents: ['claude', 'codex', 'pi'] }
    mounted?.unmount()
    mounted = null
  })

  it('every slot taken: Start says Queue, with the place it would get; the action is the same delegate', async () => {
    startReply = { agent, agents: ['claude'], slots: { max: 2, busy: 2, waiting: 2 } }
    await open(todo)
    await vi.waitFor(() => expect(button(/^Queue$/)).toBeTruthy())
    expect(button(/^Start$/)).toBeUndefined()
    expect(document.querySelector('.task-queue-place')?.textContent).toBe('3rd in the queue · all 2 slots are taken')
    button(/^Queue$/)!.click()
    await vi.waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0]).toEqual({ url: 'action', body: { machine: 'a', id: 'demo/1', action: 'delegate' } })
  })

  it('a free slot (or slots not known): Start, no place', async () => {
    startReply = { agent, agents: ['claude'], slots: { max: 2, busy: 1, waiting: 0 } }
    await open(todo)
    await vi.waitFor(() => expect(button(/^Start$/)).toBeTruthy())
    expect(document.querySelector('.task-queue-place')).toBeNull()
  })

  it('Start after…: finds tasks of every machine by key or title, and sends delegate --after', async () => {
    startReply = { agent, agents: ['claude'], slots: null }
    await open(todo)
    await vi.waitFor(() => expect(button(/^Start after…$/)).toBeTruthy())
    button(/^Start after…$/)!.click()
    const refs = () => [...document.querySelectorAll('.task-after-choice .mono')].map(e => e.textContent)
    // Not itself, nor a done task; another machine's with its label.
    await vi.waitFor(() => expect(refs()).toEqual(['DEMO-37', 'b:ELA-3']))
    const input = document.querySelector<HTMLInputElement>('.task-after-search input')!
    input.value = 'api'
    input.dispatchEvent(new Event('input'))
    await vi.waitFor(() => expect(refs()).toEqual(['b:ELA-3']))
    document.querySelector<HTMLButtonElement>('.task-after-choice')!.click()
    await flushPromises()
    expect([...document.querySelectorAll('.task-after-pick .task-wait-chip')].map(c => c.textContent?.trim())).toEqual(['b:ELA-3'])
    // A key typed for a task the Board does not list is taken as it is.
    input.value = 'vm-str:ELA-9'
    input.dispatchEvent(new Event('input'))
    await vi.waitFor(() => expect(refs()).toEqual(['vm-str:ELA-9']))
    document.querySelector<HTMLButtonElement>('.task-after-choice')!.click()
    await flushPromises()
    button(/^Start after 2 tasks$/)!.click()
    await vi.waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0]).toEqual({ url: 'action', body: { machine: 'a', id: 'demo/1', action: 'delegate', after: ['b:ELA-3', 'vm-str:ELA-9'] } })
  })

  it('the board\'s refusal (a circle, an unknown id, a machine that does not answer) is shown as it is', async () => {
    startReply = { agent, agents: ['claude'], slots: null }
    await open(todo)
    await vi.waitFor(() => expect(button(/^Start after…$/)).toBeTruthy())
    button(/^Start after…$/)!.click()
    await vi.waitFor(() => expect(document.querySelector('.task-after-choice')).toBeTruthy())
    document.querySelector<HTMLButtonElement>('.task-after-choice')!.click()
    await flushPromises()
    refuse = 'DEMO-1 cannot wait for that: tasks would wait on each other (DEMO-1 → DEMO-37 → DEMO-1). Nothing was changed.'
    button(/^Start after DEMO-37$/)!.click()
    await vi.waitFor(() => expect(document.querySelector('.task-sheet-error')?.textContent).toBe(refuse))
    // The picker stays, with its pick, to change it.
    expect(document.querySelector('.task-after-pick .task-wait-chip')?.textContent?.trim()).toBe('DEMO-37')
  })

  it('a task that waits: what for (its key, done or not), and Stop waiting sends after --clear', async () => {
    const waiting: TaskRow = { ...todo, state: 'working', stage: 'after', group: 'working', msg: 'queued after DEMO-37' }
    await open(waiting, { after: { waitsFor: ['demo/37', 'demo/36'], left: ['demo/37'], waiting: true, forYou: '', titles: { 'demo/37': 'Login page' } } })
    await vi.waitFor(() => expect(document.querySelector('.task-wait')).toBeTruthy())
    const chips = [...document.querySelectorAll('.task-wait .task-wait-chip')]
    // Named by their keys, as the Board names them; the one done marked.
    expect(chips.map(c => c.firstChild?.textContent?.trim())).toEqual(['DEMO-37', 'DEMO-36'])
    expect(chips.map(c => c.querySelector('small')?.textContent ?? '')).toEqual(['', 'done'])
    expect(document.querySelector('.task-wait-line')?.textContent).toContain('Waits for')
    expect(chips[0]!.getAttribute('title')).toBe('Login page')
    // Its line is not said twice.
    expect(document.querySelector('.task-sheet-msg')).toBeNull()
    document.querySelector<HTMLButtonElement>('.task-wait-clear')!.click()
    await vi.waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0]).toEqual({ url: 'after', body: { machine: 'a', id: 'demo/1' } })
  })

  it('a task in the queue: its place', async () => {
    await open({ ...todo, state: 'working', stage: 'queued', group: 'working', queue: 2, msg: 'Waiting for a free slot' })
    await vi.waitFor(() => expect(document.querySelector('.task-wait')?.textContent).toContain('Waiting for a free slot · 2nd in the queue'))
    expect(document.querySelector('.task-wait h4')?.textContent).toBe('In the queue')
  })

  it('a task of the backlog that is to wait: said, with Start and Stop waiting', async () => {
    startReply = { agent, agents: ['claude'], slots: null }
    await open(todo, { after: { waitsFor: ['demo/37'], left: ['demo/37'], waiting: false, forYou: '', titles: {} } })
    await vi.waitFor(() => expect(document.querySelector('.task-wait-line')?.textContent).toContain('Will wait for'))
    expect(button(/^Start$/)).toBeTruthy()
    expect(document.querySelector('.task-wait-clear')).toBeTruthy()
  })
})

describe('asking the coordinator from the task sheet', () => {
  it('offers a separate question for a to-do task on another machine, then opens the coordinator', async () => {
    const { w } = await sheet(true)
    await w.setProps({ task: { ...task, stage: 'todo', state: 'idle', group: 'todo' }, machine: 'remote' })
    await flushPromises()
    const ask = w.findAll('button').find(b => b.text() === 'Ask the coordinator')!
    await ask.trigger('click')
    await w.get('textarea').setValue('What does it need?')
    await w.get('form.task-question').trigger('submit')
    await flushPromises()
    expect(questionBody).toEqual({ machine: 'remote', id: 'demo/1', text: 'What does it need?' })
    await vi.waitFor(() => expect(w.emitted('coordinator')?.[0]).toEqual(['remote', expect.objectContaining({ id: 'demo/1' })]))
    expect(held).toHaveLength(0)
    w.unmount()
  })
  it('keeps a failed question editable and clears it when switching tasks', async () => {
    questionFails = true
    const { w } = await sheet(true)
    await w.findAll('button').find(b => b.text() === 'Ask the coordinator')!.trigger('click')
    await w.get('textarea').setValue('Why?')
    await w.get('form.task-question').trigger('submit')
    await flushPromises()
    await vi.waitFor(() => expect(w.get('textarea').attributes('disabled')).toBeUndefined())
    expect(w.props('open')).toBe(true)
    expect((w.get('textarea').element as HTMLTextAreaElement).value).toBe('Why?')
    expect(w.emitted('coordinator')).toBeUndefined()
    await w.setProps({ machine: 'another' })
    await flushPromises()
    expect(w.find('form.task-question').exists()).toBe(false)
    questionFails = false
    w.unmount()
  })
})

it('hides coordinator questions on archived task sheets', async () => {
  const { w } = await sheet(true)
  expect(w.text()).toContain('Ask the coordinator')
  await w.setProps({ task: { ...task, archived: true } })
  expect(w.text()).not.toContain('Ask the coordinator')
  w.unmount()
})

it('a late question reply never opens the coordinator over another task', async () => {
  questionHeld = true
  const { w } = await sheet(true)
  await w.findAll('button').find(b => b.text() === 'Ask the coordinator')!.trigger('click')
  await w.get('textarea').setValue('What does it need?')
  await w.get('form.task-question').trigger('submit')
  await vi.waitFor(() => expect(held).toHaveLength(1))
  await w.setProps({ machine: 'another' })
  held.shift()!()
  await flushPromises()
  expect(w.emitted('coordinator')).toBeUndefined()
  expect(w.props('open')).toBe(true)
  questionHeld = false
  w.unmount()
})

it('opens coordinator replies in one tap without sending a question', async () => {
  const { w } = await sheet(true)
  expect(w.find('form.task-question').exists()).toBe(false)
  await w.findAll('button').find(b => b.text() === 'Coordinator replies')!.trigger('click')
  expect(w.emitted('coordinator')?.[0]).toEqual(['a', expect.objectContaining({ id: 'demo/1' })])
  expect(w.props('open')).toBe(false)
  w.unmount()
})
