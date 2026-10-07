import { describe, expect, it } from 'vitest'
import { EXEC_MAX, SSH_MAX_SESSIONS, STREAM_MARGIN, SessionGate, isRefused } from '../server/utils/sshgate'

const deferred = <T>() => Promise.withResolvers<T>()
// Lets the gate's promise chain settle (microtasks only, no clock).
const tick = async () => { for (let i = 0; i < 20; i++) await Promise.resolve() }

describe('SessionGate', () => {
  it('runs at most EXEC_MAX commands at once and queues the rest', async () => {
    const gate = new SessionGate()
    const pending = Array.from({ length: EXEC_MAX + 3 }, () => deferred<string>())
    let started = 0
    const runs = pending.map((d, i) => gate.run(() => { started++; return d.promise }, () => false, `k${i}`))
    await tick()
    expect(started).toBe(EXEC_MAX)
    expect(gate.stats().queued).toBe(3)
    pending[0]!.resolve('a')
    await tick()
    expect(started).toBe(EXEC_MAX + 1)
    pending.forEach(d => d.resolve('x'))
    await Promise.all(runs)
    expect(gate.stats().peak).toBe(EXEC_MAX)
  })

  it('leaves room for new streams: commands + streams stay under the sshd cap', async () => {
    const gate = new SessionGate()
    const closes = Array.from({ length: 5 }, () => gate.openStream())
    const d = deferred<number>()
    let started = 0
    const runs = Array.from({ length: 6 }, () => gate.run(() => { started++; return d.promise }, () => false))
    await tick()
    expect(started).toBe(SSH_MAX_SESSIONS - STREAM_MARGIN - 5)
    closes.forEach(c => c())
    await tick()
    expect(started).toBe(6)
    d.resolve(0)
    await Promise.all(runs)
  })

  it('always lets one command through, even with every session taken by streams', async () => {
    const gate = new SessionGate()
    for (let i = 0; i < SSH_MAX_SESSIONS + 2; i++) gate.openStream()
    await expect(gate.run(async () => 'ok', () => false)).resolves.toBe('ok')
  })

  it('a closed stream is only counted once', () => {
    const gate = new SessionGate()
    const close = gate.openStream()
    close()
    close()
    expect(gate.stats().streams).toBe(0)
  })

  it('retries a refused session, then returns the command result', async () => {
    const seen: number[] = []
    const gate = new SessionGate({ retryDelays: [1, 1, 1], onRefused: (_, attempt) => seen.push(attempt) })
    let calls = 0
    const r = await gate.run(async () => (++calls < 3 ? 'refused' : 'ok'), v => v === 'refused')
    expect(r).toBe('ok')
    expect(calls).toBe(3)
    expect(seen).toEqual([1, 2])
  })

  it('gives up after the last retry with the refusal', async () => {
    const gate = new SessionGate({ retryDelays: [1, 1] })
    let calls = 0
    const r = await gate.run(async () => { calls++; return 'refused' }, v => v === 'refused')
    expect(r).toBe('refused')
    expect(calls).toBe(3)
    expect(gate.stats().refusals).toBe(3)
  })

  it('shares an identical command already running, not a finished one', async () => {
    const gate = new SessionGate()
    const d = deferred<string>()
    let calls = 0
    const fn = () => { calls++; return d.promise }
    const a = gate.run(fn, () => false, 'same')
    const b = gate.run(fn, () => false, 'same')
    d.resolve('v')
    expect(await Promise.all([a, b])).toEqual(['v', 'v'])
    expect(calls).toBe(1)
    await gate.run(async () => { calls++; return 'w' }, () => false, 'same')
    expect(calls).toBe(2)
  })

  it('does not keep a failed shared command', async () => {
    const gate = new SessionGate()
    await expect(gate.run(async () => { throw new Error('boom') }, () => false, 'k')).rejects.toThrow('boom')
    await expect(gate.run(async () => 'ok', () => false, 'k')).resolves.toBe('ok')
    expect(gate.stats().execs).toBe(0)
  })
})

describe('isRefused', () => {
  it('recognises the refusals of a full multiplexed connection', () => {
    expect(isRefused('mux_client_request_session: session request failed: Session open refused by peer\nConnection closed by UNKNOWN port 65535')).toBe(true)
    expect(isRefused('channel 3: open failed: administratively prohibited: open failed')).toBe(true)
    expect(isRefused('cat: x: No such file or directory')).toBe(false)
  })
})
