import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { bindFunction } from './stateFunction'
import { HerdrError } from '../server/utils/herdr'
import { inputBox, clearKeys } from '../server/utils/unqueue'
import { INPUT_STATES, nextHeld, checkQueue, HOLD_TTL_MS, type QueueEntry } from '../server/utils/queued'
import { BASH_EMPTY } from '../server/utils/guardedSend'

const source = readFileSync(new URL('../server/utils/state.ts', import.meta.url), 'utf8').replace('export async function clearQueuedInput', 'async function clearQueuedInput')
function setup(patch = {}, boxes = ['ns', '']) {
  const q: QueueEntry = { id: 'q', text: 'hello', at: 0, held: true, busy: true, inputText: 'ns' }
  const keys = vi.fn(async () => {})
  const schedule = vi.fn()
  const clear = bindFunction(source, 'clearQueuedInput', {
    findPane: () => ({ id: 'w1:p1', agent: 'claude', status: 'idle', ...patch }),
    queued: new Map([['w1:p1', [q]]]), withPaneLock: (_: string, fn: () => unknown) => fn(),
    restarting: () => false, HerdrError, herdr: async () => ({ read: { text: 'field' } }), inputVisible: () => true,
    fieldDeps: () => ({ box: async () => boxes.shift(), keys }), inputBox: () => {}, clearKeys, BASH_EMPTY,
    sleep: async () => {}, poll: () => {}, setTimeout: schedule,
  }) as (pane: string, id: string, expected: string) => Promise<void>
  return { clear: () => clear('w1:p1', 'q', 'ns'), q, keys, schedule }
}
describe('clear queued terminal input', () => {
  it('clears a known draft and schedules normal ordered delivery', async () => {
    const t = setup()
    await t.clear()
    expect(t.keys).toHaveBeenCalledWith(clearKeys(1))
    expect(t.q.busy).toBe(true)
    // Even an old hold must survive the poll between clearing and delivery.
    expect(checkQueue([t.q], 'idle', HOLD_TTL_MS + 1)).toBe(false)
    expect(t.q.failed).toBeUndefined()
    expect(t.schedule).toHaveBeenCalledOnce()
  })
  it.each([{ status: 'working' }, { status: 'blocked' }, { stopped: {} }, { menu: {} }, { prompt: {} }, { leaving: true }])('rejects an unavailable agent %j', async patch => {
    const t = setup(patch)
    await expect(t.clear()).rejects.toMatchObject({ code: 'stale' })
    expect(t.keys).not.toHaveBeenCalled()
  })
  it('does not erase a changed draft', async () => {
    const t = setup({}, ['new text'])
    await expect(t.clear()).rejects.toMatchObject({ code: 'stale' })
    expect(t.keys).not.toHaveBeenCalled()
  })
  it('does not schedule delivery if clearing failed', async () => {
    const t = setup({}, ['ns', 'ns'])
    await expect(t.clear()).rejects.toMatchObject({ code: 'input_busy' })
    expect(t.schedule).not.toHaveBeenCalled()
  })
})

// Exercise the same screen parser and polling path that resume automatic delivery.
describe('detecting a held terminal draft', () => {
  it('publishes a bounded preview, refreshes it, then sends automatically when empty', async () => {
    const q: QueueEntry = { id: 'q', text: 'hello', at: 1, held: true }
    let draft = 'ns'
    const typeHeld = vi.fn(async () => {})
    const deliver = bindFunction(source, 'deliverHeld', {
      nextHeld, queued: new Map([['w1:p1', [q]]]), deliverBusy: new Set(), INPUT_STATES,
      restarting: () => false, herdr: async () => ({ read: { text: 'field' } }), inputVisible: () => true,
      fieldDeps: () => ({ box: async () => inputBox(`────────\n❯\u00a0${draft}\n────────`) }), inputBox, BASH_EMPTY,
      typeHeld, heldFailed: (p: unknown, q: unknown, e: unknown) => { throw e },
    }) as (p: unknown) => void
    const p = { id: 'w1:p1', agent: 'claude', status: 'idle' }
    deliver(p)
    await vi.waitFor(() => expect(q.inputText).toBe('ns'))
    expect(typeHeld).not.toHaveBeenCalled()
    draft = 'x'.repeat(200)
    deliver(p)
    await vi.waitFor(() => expect(q.inputText).toBe('x'.repeat(160) + '…'))
    draft = ''
    deliver(p)
    await vi.waitFor(() => expect(typeHeld).toHaveBeenCalledOnce())
    expect(q.busy).toBe(false)
    expect(q.inputText).toBeUndefined()
    q.typedAt = 1
    draft = 'ns'
    deliver(p)
    await vi.waitFor(() => expect(typeHeld).toHaveBeenCalledTimes(2))
  })
})
