import { afterEach, expect, it, vi } from 'vitest'
import { withPaneLock } from '../server/utils/guardedSend'
import { HerdrError } from '../server/utils/herdr'
import { interruptAgent } from '../server/utils/interruptSeq'

vi.mock('../server/utils/interruptSeq', () => ({ interruptAgent: vi.fn() }))
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); vi.resetAllMocks() })

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(r => { resolve = r })
  return { promise, resolve }
}

async function setup() {
  vi.useFakeTimers()
  const pane = { id: 'w1:p1', agent: 'claude' }
  const find = vi.fn(() => pane as typeof pane | null)
  const restore = vi.fn(async () => ({ text: 'Draft' }))
  for (const [name, value] of Object.entries({
    defineApi: (h: unknown) => h, PANE_RE: /^w1:p[12]$/, HerdrError, withPaneLock,
    findPane: find, takeBackFromClaude: restore, takeBack: () => ({ text: 'Draft', lost: 0 }),
    poll: vi.fn(), log: vi.fn(), sleep: vi.fn(),
  })) vi.stubGlobal(name, value)
  vi.mocked(interruptAgent).mockResolvedValue({ stopped: true, esc: 1, background: 0 })
  const handler = (await import('../server/api/interrupt.post')).default
  return { find, restore, run: () => handler({}, { pane_id: pane.id, restore: true }) }
}

it('waits for an ongoing pane write, then holds the lock through draft recovery', async () => {
  const t = await setup()
  const send = deferred()
  const recovery = deferred()
  const writing = withPaneLock('w1:p1', () => send.promise)
  const restoring = deferred()
  t.restore.mockImplementation(async () => { restoring.resolve(); await recovery.promise; return { text: 'Draft' } })
  const result = t.run()
  const next = vi.fn(async () => {})
  const queued = withPaneLock('w1:p1', next)
  await Promise.resolve()
  expect(interruptAgent).not.toHaveBeenCalled()
  expect(t.find).not.toHaveBeenCalled()
  // Another pane remains writable during the interruption.
  await expect(withPaneLock('w1:p2', async () => 'free')).resolves.toBe('free')
  send.resolve()
  await writing
  await restoring.promise
  expect(interruptAgent).toHaveBeenCalledOnce()
  expect(next).not.toHaveBeenCalled()
  recovery.resolve()
  await expect(result).resolves.toMatchObject({ ok: true, stopped: true, restored: 'Draft' })
  await queued
  expect(next).toHaveBeenCalledOnce()
})

it('rechecks the pane after acquiring the lock and releases it after an error', async () => {
  const t = await setup()
  const send = deferred()
  const writing = withPaneLock('w1:p1', () => send.promise)
  const result = t.run()
  const rejected = expect(result).rejects.toMatchObject({ code: 'bad_pane' })
  t.find.mockReturnValue(null)
  send.resolve()
  await writing
  await rejected
  expect(interruptAgent).not.toHaveBeenCalled()
  await expect(withPaneLock('w1:p1', async () => 'released')).resolves.toBe('released')
})
