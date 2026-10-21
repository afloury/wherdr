import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { readBody } from 'h3'
import { mockNuxtImport, mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import TaskSheet from '~/components/TaskSheet.vue'
import type { TaskRow } from '#shared/projectsTasks'
import { hiddenAgents } from '~/composables/useHerdr'

mockNuxtImport('askConfirm', () => async () => true)

// Each action's reply is held until the test lets it go.
const held: Array<() => void> = []
function hold() { return new Promise(resolve => { held.push(() => resolve({ ok: true, msg: 'done' })) }) }
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
    expect(startButton()!.textContent?.trim()).toBe('Start')
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
    expect(startButton()!.textContent?.trim()).toBe('Start')
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
