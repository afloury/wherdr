import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import type { Socket } from 'node:net'
import { CoreSession } from '../server/utils/coreSession'
import { applyCoreEvent, type CoreTerminals } from '../shared/coreEvents'
import { createCoreAlerts } from '../server/utils/coreAlerts'
import type { CoreTerminal } from '../shared/coreInventory'

class FakeSocket extends EventEmitter {
  written: string[] = []
  destroyed = false
  write(s: string) { this.written.push(s); return true }
  destroy() { this.destroyed = true; return this }
  feed(...lines: object[]) { this.emit('data', Buffer.from(lines.map(l => JSON.stringify(l) + '\n').join(''))) }
}
const term = (address: string, extra: Partial<CoreTerminal> = {}): CoreTerminal => ({ address, cwd: '/w', state: 'live', ...extra })
const ev = (seq: number, type: string, terminal: string, data: object = {}) => ({ jsonrpc: '2.0', method: 'event', params: { seq, type, terminal, data } })

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

function open(opts: { watchdogMs?: number } = {}) {
  const sockets: FakeSocket[] = []
  const log: string[] = []
  const onEvent = vi.fn()
  const session = new CoreSession({ endpoint: 'x', ...opts, onEvent, onChange: w => log.push(w), onStatus: c => log.push(c ? 'up' : 'down'),
    connect: () => { const s = new FakeSocket(); sockets.push(s); queueMicrotask(() => s.emit('connect')); return s as unknown as Socket } })
  session.start()
  return { session, sockets, log, onEvent }
}

it('subscribes, holds the snapshot and applies events in order', async () => {
  const { session, sockets, onEvent } = open()
  await Promise.resolve()
  expect(JSON.parse(sockets[0]!.written[0]!)).toMatchObject({ method: 'events.subscribe' })
  expect(session.snapshot()).toBeNull()
  sockets[0]!.feed({ jsonrpc: '2.0', id: 1, result: { seq: 5, terminals: [term('t1')] } })
  expect(session.snapshot()?.map(t => t.address)).toEqual(['t1'])
  sockets[0]!.feed(ev(6, 'status', 't1', { status: { state: 'working' } }), { jsonrpc: '2.0', method: 'event', params: { type: 'heartbeat' } })
  expect(session.get('t1')?.status?.state).toBe('working')
  expect(onEvent).toHaveBeenCalledTimes(1)
  session.stop()
})

it('buffers events that arrive before the snapshot and skips those it already holds', async () => {
  const { session, sockets } = open()
  await Promise.resolve()
  sockets[0]!.feed(ev(4, 'title', 't1', { title: 'old' }), ev(6, 'title', 't1', { title: 'new' }))
  sockets[0]!.feed({ jsonrpc: '2.0', id: 1, result: { seq: 5, terminals: [term('t1')] } })
  expect(session.get('t1')?.title).toBe('new')
  session.stop()
})

it('handles frames split anywhere', async () => {
  const { session, sockets } = open()
  await Promise.resolve()
  const text = JSON.stringify({ jsonrpc: '2.0', id: 1, result: { seq: 1, terminals: [term('t1')] } }) + '\n'
  sockets[0]!.emit('data', Buffer.from(text.slice(0, 20)))
  expect(session.snapshot()).toBeNull()
  sockets[0]!.emit('data', Buffer.from(text.slice(20)))
  expect(session.snapshot()).toHaveLength(1)
  session.stop()
})

it('reconnects with a new snapshot on a seq gap, on missed, and on silence', async () => {
  const { session, sockets, log } = open({ watchdogMs: 1000 })
  await Promise.resolve()
  sockets[0]!.feed({ jsonrpc: '2.0', id: 1, result: { seq: 1, terminals: [term('t1')] } })
  sockets[0]!.feed(ev(3, 'title', 't1', { title: 'gap' }))
  expect(sockets[0]!.destroyed).toBe(true)
  expect(session.snapshot()).toBeNull()
  await vi.advanceTimersByTimeAsync(250)
  expect(sockets).toHaveLength(2)
  sockets[1]!.feed({ jsonrpc: '2.0', id: 1, result: { seq: 9, terminals: [term('t1')] } })
  sockets[1]!.feed({ jsonrpc: '2.0', method: 'event', params: { type: 'missed' } })
  expect(sockets[1]!.destroyed).toBe(true)
  await vi.advanceTimersByTimeAsync(250) // backoff reset after a snapshot
  expect(sockets).toHaveLength(3)
  sockets[2]!.feed({ jsonrpc: '2.0', id: 1, result: { seq: 1, terminals: [] } })
  await vi.advanceTimersByTimeAsync(1100) // no event nor heartbeat
  expect(sockets[2]!.destroyed).toBe(true)
  expect(log).toContain('down')
  session.stop()
})

it('does not retry an incompatible core', async () => {
  const { session, sockets } = open()
  await Promise.resolve()
  sockets[0]!.feed({ jsonrpc: '2.0', id: 1, error: { code: -1, message: 'x', data: { kind: 'unsupported_generation' } } })
  await vi.advanceTimersByTimeAsync(60000)
  expect(sockets).toHaveLength(1)
  session.stop()
})

it('applies each event type and ignores unknown ones', () => {
  const m: CoreTerminals = new Map()
  expect(applyCoreEvent(m, { type: 'created', terminal: 't1', data: { address: 't1', cwd: '/w', state: 'live' } })).toBe('terminal')
  applyCoreEvent(m, { type: 'status', terminal: 't1', data: { status: { state: 'blocked' } } })
  applyCoreEvent(m, { type: 'turn', terminal: 't1', data: { turn: 3 } })
  applyCoreEvent(m, { type: 'labels', terminal: 't1', data: { labels: { a: 'b' } } })
  applyCoreEvent(m, { type: 'size', terminal: 't1', data: { cols: 100, rows: 30 } })
  expect(m.get('t1')).toMatchObject({ status: { state: 'blocked' }, turn: 3, labels: { a: 'b' }, cols: 100, rows: 30 })
  expect(applyCoreEvent(m, { type: 'whatever', terminal: 't1' })).toBeNull()
  expect(applyCoreEvent(m, { type: 'title', terminal: 'nope', data: { title: 'x' } })).toBeNull()
  expect(applyCoreEvent(m, { type: 'doc' })).toBe('doc')
  applyCoreEvent(m, { type: 'finished', terminal: 't1' })
  expect(m.size).toBe(0)
})

function alerts() {
  const held = new Map<string, CoreTerminal>()
  const sent: string[] = []
  const a = createCoreAlerts({ settleMs: 100, current: x => held.get(x), send: (x, k) => sent.push(`${x}:${k}`) })
  const status = (address: string, state: string, extra: Partial<CoreTerminal> = {}) => {
    const before = held.get(address)
    const after = { ...(before ?? term(address)), ...extra, status: { state } }
    held.set(address, after)
    a.onEvent({ type: 'status', terminal: address }, before, after)
  }
  return { status, sent, a }
}

it('alerts once when an agent needs input or finishes, after the settle delay', async () => {
  const { status, sent } = alerts()
  status('t1', 'working')
  status('t1', 'blocked')
  expect(sent).toEqual([])
  await vi.advanceTimersByTimeAsync(100)
  expect(sent).toEqual(['t1:needs-you'])
  status('t1', 'working')
  status('t1', 'idle')
  await vi.advanceTimersByTimeAsync(100)
  expect(sent).toEqual(['t1:needs-you', 't1:finished'])
})

it('sends nothing for a sub-agent, a flicker, a repeat in the same turn or a first sighting', async () => {
  const { status, sent } = alerts()
  status('child', 'working', { parent: 't1' })
  status('child', 'idle')
  status('t2', 'working')
  status('t2', 'idle')
  status('t2', 'working') // back before the settle delay
  await vi.advanceTimersByTimeAsync(100)
  status('t2', 'idle')
  status('t2', 'working')
  status('t2', 'idle') // same turn, same kind: once
  await vi.advanceTimersByTimeAsync(100)
  status('t3', 'idle') // nothing known before: not a finish
  await vi.advanceTimersByTimeAsync(100)
  expect(sent).toEqual(['t2:finished'])
})

it('a reconnect snapshot raises no alert (only live events do)', async () => {
  const { sockets, onEvent } = open()
  await Promise.resolve()
  sockets[0]!.feed({ jsonrpc: '2.0', id: 1, result: { seq: 1, terminals: [term('t1', { status: { state: 'blocked' } })] } })
  expect(onEvent).not.toHaveBeenCalled()
})
