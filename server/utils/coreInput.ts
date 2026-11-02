// Composer, keys, interrupt and stop on herdr-core: terminal.send / keys /
// interrupt / kill on the pane's full core address. Never retried: a timeout
// does not prove the text or key did not reach the program.
import { coreCall, CoreError } from './core'
import { HerdrError } from './herdr'
import type { Pane } from '../../shared/types'

type Call = <T>(method: string, params: object, timeout: number) => Promise<T>
export interface CoreInputDeps { call: Call, pane: (id: string) => Pane | undefined, panes: () => Pane[], refresh: () => void }

const KEY_RE = /^[a-z0-9+\-]{1,24}$/i
const MAX_TEXT = 256 * 1024

export function coreInputDeps(): CoreInputDeps {
  return {
    call: (method, params, timeout) => {
      const endpoint = process.env.HC_SOCKET
      if (!endpoint) return Promise.reject(new CoreError('unavailable', 'Missing core endpoint'))
      return coreCall(endpoint, method, params, timeout)
    },
    pane: id => findPane(id),
    panes: () => getState().panes,
    refresh: () => { setTimeout(() => { void poll() }, 100) },
  }
}

function target(deps: CoreInputDeps, id: unknown) {
  const p = typeof id === 'string' ? deps.pane(id) : undefined
  if (!p?.coreAddress) throw new HerdrError('bad_pane', 'Pane not found')
  return p
}

// Core's stable error kinds, as the interface's messages.
function failure(e: unknown): never {
  if (e instanceof HerdrError) throw e
  const kind = e instanceof CoreError ? e.kind : 'internal'
  if (kind === 'not_found' || kind === 'finished') throw new HerdrError('stale', 'This terminal has ended')
  if (kind === 'blocked') throw new HerdrError('blocked', 'The agent is waiting for an answer: reply in the terminal')
  if (kind === 'timeout') throw new HerdrError('timeout', 'herdr-core did not confirm in time: check the terminal before sending again')
  if (kind === 'unreachable' || kind === 'machine_unknown') throw new HerdrError('unreachable', 'The machine of this terminal is unreachable')
  if (kind === 'unavailable' || kind === 'disconnected') throw new HerdrError('unreachable', 'herdr-core is unreachable')
  throw new HerdrError(kind, e instanceof Error ? e.message : 'herdr-core rejected the request')
}

// Message from the composer: pasted, then submitted with Enter once nobody types.
export async function coreSend(deps: CoreInputDeps, b: { pane_id?: unknown, text?: unknown }) {
  const p = target(deps, b.pane_id)
  const text = typeof b.text === 'string' ? b.text : ''
  if (!text.trim()) throw new HerdrError('empty', 'Empty message')
  if (text.length > MAX_TEXT) throw new HerdrError('too_large', 'Message too large')
  try {
    const r = await deps.call<{ started?: boolean | null }>('terminal.send', { terminal: p.coreAddress, text }, 30000)
    return { ok: true, started: r?.started ?? null }
  } catch (e) { failure(e) } finally { deps.refresh() }
}

// Raw route: text + Enter is a message, named keys go through terminal.keys.
export async function coreInput(deps: CoreInputDeps, b: { pane_id?: unknown, text?: unknown, keys?: unknown }) {
  const keys = Array.isArray(b.keys) ? b.keys : []
  if (typeof b.text === 'string' && b.text) {
    if (keys.length !== 1 || keys[0] !== 'enter') throw new HerdrError('unsupported', 'Type this text in the terminal')
    return coreSend(deps, b)
  }
  const p = target(deps, b.pane_id)
  if (!keys.length || keys.length > 32 || !keys.every(k => typeof k === 'string' && KEY_RE.test(k))) throw new HerdrError('bad_keys', 'Invalid keys')
  try {
    await deps.call('terminal.keys', { terminal: p.coreAddress, keys }, 10000)
    return { ok: true }
  } catch (e) { failure(e) } finally { deps.refresh() }
}

// Stop button: the stop key, then what core observed. Never escalates to a kill.
export async function coreInterrupt(deps: CoreInputDeps, b: { pane_id?: unknown }) {
  const p = target(deps, b.pane_id)
  try {
    const r = await deps.call<{ outcome: string }>('terminal.interrupt', { terminal: p.coreAddress, timeout: 10 }, 15000)
    return { ok: true, outcome: r.outcome, stopped: r.outcome === 'stopped' || r.outcome === 'exited', background: 0, shell: !p.agent }
  } catch (e) { failure(e) } finally { deps.refresh() }
}

// Close: ends the program (hangup, terminate, kill). A group ends each of its terminals.
export async function coreKill(deps: CoreInputDeps, b: { pane_id?: unknown, close_group?: unknown }) {
  const p = target(deps, b.pane_id)
  const list = b.close_group === true ? deps.panes().filter(x => x.workspace === p.workspace && x.coreAddress) : [p]
  try {
    for (const x of list) await deps.call('terminal.kill', { terminal: x.coreAddress }, 15000)
    return { ok: true }
  } catch (e) { failure(e) } finally { deps.refresh() }
}
