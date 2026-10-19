import { describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { mockNuxtImport, mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import TaskSheet from '~/components/TaskSheet.vue'
import type { TaskRow } from '#shared/projectsTasks'

mockNuxtImport('askConfirm', () => async () => true)

// Each action's reply is held until the test lets it go.
const held: Array<() => void> = []
function hold() { return new Promise(resolve => { held.push(() => resolve({ ok: true, msg: 'done' })) }) }
registerEndpoint('/api/tasks/tell', { method: 'POST', handler: hold })
registerEndpoint('/api/tasks/approve', { method: 'POST', handler: hold })
registerEndpoint('/api/tasks/action', { method: 'POST', handler: hold })
// What the details say, and how many times they were read.
const shown = { stage: 'approval', failure: '', failureStage: '' }
let detailsReads = 0
registerEndpoint('/api/tasks/details', () => {
  detailsReads++
  return { id: 'demo/1', title: 'Fix login', msg: '', description: '', agent: 'claude', pr: '', branch: '', worktree: '', failureAuth: false, pane: null, ...shown }
})

const task: TaskRow = {
  id: 'demo/1', repo: 'demo', n: 1, state: 'blocked', kind: '', stage: 'approval', title: 'Fix login', msg: '', app: 'claude',
  progress: null, eta: null, pr: '', review: null, reviewRound: 0, research: false, archived: false, queue: null, group: 'needs',
}

interface SheetVm { reply: string, busy: boolean, send: () => Promise<void>, approve: () => Promise<void>, act: (a: string) => Promise<void> }
async function sheet() {
  const w = await mountSuspended(TaskSheet, { props: { task, machine: 'a', open: true, 'onUpdate:open': (v: boolean) => w.setProps({ open: v }) } })
  await flushPromises()
  return { w, vm: w.vm as unknown as SheetVm }
}
// A sent, held → the same task on machine B, with its own draft → A's reply.
async function lateReply(start: (vm: SheetVm) => Promise<void>) {
  const { w, vm } = await sheet()
  vm.reply = 'for A'
  const done = start(vm)
  await flushPromises()
  expect(held).toHaveLength(1)
  await w.setProps({ machine: 'b' })
  await flushPromises()
  vm.reply = 'draft for B'
  held.shift()!()
  await done
  await flushPromises()
  return { w, vm }
}

describe('the task sheet after a late reply', () => {
  it('Send for A leaves the draft written for B', async () => {
    const { w, vm } = await lateReply(vm => vm.send())
    expect(vm.reply).toBe('draft for B')
    expect(vm.busy).toBe(false)
    w.unmount()
  })

  it('Approve for A does not close the sheet of B', async () => {
    const { w, vm } = await lateReply(vm => vm.approve())
    expect(w.props('open')).toBe(true)
    expect(vm.reply).toBe('draft for B')
    w.unmount()
  })

  it('Archive for A does not close the sheet of B', async () => {
    const { w } = await lateReply(vm => vm.act('archive'))
    expect(w.props('open')).toBe(true)
    w.unmount()
  })

  it('B is not kept busy by A\'s request', async () => {
    const { w, vm } = await sheet()
    vm.reply = 'for A'
    const done = vm.send()
    await flushPromises()
    await w.setProps({ machine: 'b' })
    await flushPromises()
    expect(vm.busy).toBe(false)
    held.shift()!()
    await done
    w.unmount()
  })

  it('closed and opened again on A during the request: the new draft stays', async () => {
    const { w, vm } = await sheet()
    vm.reply = 'first'
    const done = vm.approve()
    await flushPromises()
    await w.setProps({ open: false })
    await w.setProps({ open: true })
    await flushPromises()
    vm.reply = 'second'
    held.shift()!()
    await done
    await flushPromises()
    expect(w.props('open')).toBe(true)
    expect(vm.reply).toBe('second')
    w.unmount()
  })

  it('still clears the reply and closes on its own task', async () => {
    const { w, vm } = await sheet()
    vm.reply = 'hello'
    const sent = vm.send()
    await flushPromises()
    held.shift()!()
    await sent
    expect(vm.reply).toBe('')
    const approved = vm.approve()
    await flushPromises()
    held.shift()!()
    await approved
    await flushPromises()
    expect(w.props('open')).toBe(false)
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
