import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ cli: vi.fn(), spawn: vi.fn(), serverVersion: '0.9.2' }))
vi.mock('../server/utils/machines', () => ({
  machineOfPane: () => ({ key: '', local: true, sock: () => 'test.sock', spawnHerdr: mocks.spawn }),
  runHerdrCli: mocks.cli,
}))
vi.mock('../server/utils/state', () => ({ termSessions: new Set(), getState: () => ({ version: mocks.serverVersion }) }))
vi.mock('../server/utils/paneSizes', () => ({
  createPaneSizes: () => ({ hold: async () => ({ resized: vi.fn(), release: vi.fn() }) }),
}))

beforeEach(() => { vi.resetModules(); mocks.cli.mockReset() })

afterEach(() => { mocks.serverVersion = '0.9.2'; vi.useRealTimers() })
async function relay(version: string) {
  vi.useFakeTimers()
  const { openTerm } = await import('../server/utils/terminal')
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), exitCode: null, kill: vi.fn(),
  })
  mocks.spawn.mockReturnValue(child)
  mocks.cli.mockResolvedValue({ code: 0, stdout: Buffer.from(`herdr ${version}`) })
  let input = ''
  child.stdin.on('data', b => { input += b.toString() })
  const send = vi.fn()
  const session = openTerm({ send, close: vi.fn(), isOpen: () => true }, new URL('http://example.test/ws/term?pane=w1:p1&cols=80&rows=24'))!
  await vi.advanceTimersByTimeAsync(0)
  return { session, send, input: () => input }
}

describe('terminal mouse relay', () => {
  it.each(['exit', 'throw'] as const)('retries a failed version read (%s) on the next attach', async failure => {
    if (failure === 'exit') mocks.cli.mockResolvedValueOnce({ code: 1, stdout: Buffer.alloc(0) })
    else mocks.cli.mockRejectedValueOnce(new Error('CLI unreachable'))
    const first = await relay('0.9.2')
    expect(first.send).toHaveBeenCalledWith(JSON.stringify({ type: 'web.capabilities', mouse: false }))
    first.session.onClose(true)
    const next = await relay('0.9.2')
    expect(next.send).toHaveBeenCalledWith(JSON.stringify({ type: 'web.capabilities', mouse: true }))
    expect(mocks.cli).toHaveBeenCalledTimes(2)
    next.session.onClose(true)
    await vi.advanceTimersByTimeAsync(1500)
  })
  it('reuses a successful version read across terminal attaches', async () => {
    const first = await relay('0.9.2')
    first.session.onClose(true)
    const next = await relay('0.9.2')
    expect(next.send).toHaveBeenCalledWith(JSON.stringify({ type: 'web.capabilities', mouse: true }))
    expect(mocks.cli).toHaveBeenCalledTimes(1)
    next.session.onClose(true)
    await vi.advanceTimersByTimeAsync(1500)
  })
  it('advertises capability and forwards validated mouse events to the owning CLI', async () => {
    const r = await relay('0.9.2')
    expect(r.send).toHaveBeenCalledWith(JSON.stringify({ type: 'web.capabilities', mouse: true }))
    const event = { type: 'terminal.mouse', action: 'down', button: 'left', column: 4, row: 3, modifiers: 0 }
    r.session.onMessage(JSON.stringify(event))
    expect(JSON.parse(r.input())).toEqual(event)
    r.session.onMessage(JSON.stringify({ ...event, column: 100 }))
    expect(r.input().trim().split('\n')).toHaveLength(1)
    r.session.onClose(true)
    await vi.advanceTimersByTimeAsync(1500)
  })
  it('disables mouse when a newer CLI talks to an older server', async () => {
    mocks.serverVersion = '0.9.1'
    const r = await relay('0.9.5')
    expect(r.send).toHaveBeenCalledWith(JSON.stringify({ type: 'web.capabilities', mouse: false }))
    r.session.onClose(true)
    await vi.advanceTimersByTimeAsync(1500)
  })
  it('keeps old CLI sessions usable and drops mouse messages', async () => {
    const r = await relay('0.9.1')
    expect(r.send).toHaveBeenCalledWith(JSON.stringify({ type: 'web.capabilities', mouse: false }))
    r.session.onMessage(JSON.stringify({ type: 'terminal.mouse', action: 'down', button: 'left', column: 4, row: 3 }))
    r.session.onMessage(JSON.stringify({ type: 'terminal.input', text: 'hello' }))
    expect(JSON.parse(r.input())).toEqual({ type: 'terminal.input', text: 'hello' })
    r.session.onClose(true)
    await vi.advanceTimersByTimeAsync(1500)
  })
})
