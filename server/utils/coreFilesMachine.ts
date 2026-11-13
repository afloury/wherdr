// Machine of an agent's file browser with herdr-core. The local core runs on this
// computer (local disk); a remote core machine is reached with `machine.exec`
// (same shell scripts as v2, through coreShell), its home folder read once.
import { coreCall } from './core'
import { HerdrError } from './herdr'
import { coreShell } from './coreTranscripts'
import { localMachine, type Machine } from './machines'
import { getState } from './state'
import { fmt } from '../../shared/message'

type Call = <T>(method: string, params: object, timeout: number) => Promise<T>
const defaultCall: Call = (method, params, timeout) => coreCall(process.env.HC_SOCKET || '', method, params, timeout)

const homes = new Map<string, string>()

export async function coreFilesMachine(key: unknown, opts: { call?: Call, machines?: () => { key: string, label: string, status: string }[] } = {}): Promise<Machine> {
  const k = String(key || '')
  if (!k) return localMachine
  const info = (opts.machines?.() ?? getState().machines ?? []).find(m => m.key === k)
  if (!info) throw new HerdrError('bad_machine', 'unknown machine')
  if (info.status !== 'online') throw new HerdrError('unreachable', fmt('{machine} is unreachable', { machine: info.label }))
  const exec = coreShell(opts.call ?? defaultCall, info.label)
  let home = homes.get(k)
  if (!home) {
    home = (await exec('printf %s "$HOME"')).stdout.toString('utf8').trim()
    if (!home.startsWith('/')) throw new HerdrError('unreachable', fmt('{machine} is unreachable', { machine: info.label }))
    homes.set(k, home)
  }
  return { ...localMachine, key: k, label: info.label, local: false, home, status: 'online', exec, spawnShell: undefined }
}
