import { readFileSync } from 'node:fs'
import { expect, it, vi } from 'vitest'
import { bindFunction } from './stateFunction'
import { loadQueued, nextHeld, type QueueEntry } from '../server/utils/queued'

const source = readFileSync(new URL('../server/utils/state.ts', import.meta.url), 'utf8')
it('claims an attachment delivery before terminal typing; restart and reconnect do not repeat it', async () => {
  const pane = { id: 'w1:p1' }
  const q: QueueEntry = { id: 'w-example', text: 'Review image\n/cache/uploads/example.jpg', at: Date.now(), held: true }
  let disk = ''
  const queued = new Map([[pane.id, [q]]])
  const sendPrompt = vi.fn(async () => {
    // Simulate a restart after the terminal accepts text but before the
    // original worker receives its acknowledgement.
    const restarted = new Map(loadQueued(JSON.parse(disk), Date.now()))
    expect(q.failed).not.toBe(true)
    expect(nextHeld(restarted.get(pane.id)!)).toBeNull()
    expect(restarted.get(pane.id)![0]!.failed).toBe(true)
    throw Object.assign(new Error('acknowledgement lost'), { typed: true })
  })
  const deliver = bindFunction(source, 'typeHeld', {
    queued, sendPrompt, saveQueued: () => { disk = JSON.stringify(Object.fromEntries(queued)) },
    isBusyError: () => false,
  })
  await expect(deliver(pane, q)).rejects.toThrow('acknowledgement lost')
  expect(await deliver(pane, q)).toBe(false)
  expect(sendPrompt).toHaveBeenCalledOnce()
})
it('checks the fresh transcript before an explicit retry, including attachments', async () => {
  const q: QueueEntry = { id: 'w-example', text: 'Review image\n/cache/uploads/example.jpg', at: 1, held: true, typedAt: 1 }
  const sendPrompt = vi.fn()
  const dropQueued = vi.fn()
  const deliver = bindFunction(source, 'typeHeld', {
    queued: new Map([['w1:p1', [q]]]), sendPrompt, dropQueued,
    transcripts: { chat: async () => ({ items: [{ role: 'user', text: 'Review image' }] }) },
    landedNow: () => true, log: () => {}, setTimeout: () => {}, poll: () => {},
  })
  expect(await deliver({ id: 'w1:p1' }, q)).toBe(true)
  expect(dropQueued).toHaveBeenCalledOnce()
  expect(sendPrompt).not.toHaveBeenCalled()
})
it('automatically retries only when the field was busy before any typing', async () => {
  const q: QueueEntry = { id: 'w-example', text: 'Review image', at: Date.now(), held: true }
  const sendPrompt = vi.fn(async () => { throw new Error('input busy') })
  const deliver = bindFunction(source, 'typeHeld', {
    queued: new Map([['w1:p1', [q]]]), sendPrompt, saveQueued: () => {},
    isBusyError: () => true, setTimeout: () => {}, poll: () => {},
  })
  expect(await deliver({ id: 'w1:p1' }, q)).toBe(false)
  expect(q.held).toBe(true)
  expect(q.failed).toBe(false)
  expect(q.typedAt).toBeUndefined()
})
