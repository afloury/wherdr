// New terminal / agent, folders and machines on herdr-core. Creation goes through
// terminal.run (no inherited parent, a correlation label, never replayed blindly);
// folders, home and installed agents of any machine through machine.exec.
import crypto from 'node:crypto'
import { posix as px } from 'node:path'
import { CoreError } from './core'
import { HerdrError } from './herdr'
import { failure } from './coreInput'
import { AGENT_KINDS } from './env'
import { HERDR_AGENT_KINDS, availableAgentKinds } from '../../shared/launchableAgents'
import { KIND_PROBE_SCRIPT } from './agentAvailability'
import { LIST_DIRS_SCRIPT, dirDeniedFromCode, parseDirList } from './fsx'
import { toAgentName } from '../../shared/ids'
import { cleanLabel } from '../../shared/spaceActions'
import { fmt } from '../../shared/message'
import type { DirEntry, DirListing, MachineConfig, MachineInfo, Pane } from '../../shared/types'

export interface CoreAdminDeps {
  call: <T>(method: string, params: object, timeout: number) => Promise<T>
  machines: () => MachineInfo[]
  panes: () => Pane[]
  settle: () => Promise<unknown> // fresh inventory, published
  recent: (m: MachineInfo) => Promise<string[]>
  remember: (dir: string, m: MachineInfo) => Promise<unknown>
}

const REQUEST_LABEL = 'wherdr-request'
const PATH_SETUP = 'export PATH="$HOME/.local/bin:$HOME/.kimi-code/bin:$HOME/.bun/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"'
const TARGET_RE = /^[A-Za-z0-9_][A-Za-z0-9_.@:%[\]-]{0,199}$/
const NAME_RE = /^[a-z0-9_][a-z0-9_.-]{0,31}$/

// Machine of a request (key '' = this one): its `on` name, or undefined for the local core.
export function machineOn(deps: CoreAdminDeps, key: unknown): { m: MachineInfo, on?: string } {
  const m = deps.machines().find(x => x.key === String(key || ''))
  if (!m) throw new HerdrError('bad_machine', 'unknown machine')
  if (!m.local && m.status !== 'online') throw new HerdrError('unreachable', fmt('{machine} is unreachable', { machine: m.label }))
  return { m, on: m.local ? undefined : m.label }
}

async function exec(deps: CoreAdminDeps, on: string | undefined, script: string, args: string[] = []) {
  try {
    const r = await deps.call<{ code: number | null, stdout: string, timed_out?: boolean }>('machine.exec',
      { argv: ['sh', '-c', script, 'sh', ...args], ...(on ? { on } : {}), timeout: 10 }, 15000)
    if (r.timed_out) throw new CoreError('timeout', 'timeout')
    return { code: r.code, stdout: Buffer.from(r.stdout || '', 'base64').toString('utf8') }
  } catch (e) { return failure(e) }
}

export async function homeOf(deps: CoreAdminDeps, on?: string) {
  const r = await exec(deps, on, 'printf %s "$HOME"')
  return r.code === 0 ? r.stdout.trim() : ''
}

const kindsCache = new Map<string, { at: number, kinds: string[] }>()
export async function kindsOf(deps: CoreAdminDeps, on?: string) {
  const old = kindsCache.get(on || '')
  if (old && Date.now() - old.at < 30_000) return old.kinds
  const candidates = HERDR_AGENT_KINDS.filter(k => AGENT_KINDS.includes(k))
  const r = await exec(deps, on, KIND_PROBE_SCRIPT, candidates)
  const found = r.code === 0 ? r.stdout.split('\n').filter(Boolean) : []
  const kinds = availableAgentKinds(found, AGENT_KINDS)
  kindsCache.set(on || '', { at: Date.now(), kinds })
  return kinds
}

// Folder under the machine's home (the same rule as v2).
function underHome(p: unknown, home: string): string | null {
  const r = px.resolve(home, String(p || '').replace(/^~(?=$|\/)/, home))
  return r === home || r.startsWith(home + '/') ? r : null
}

export async function coreListDirs(deps: CoreAdminDeps, path: string | null, machine: unknown): Promise<DirListing> {
  const { on } = machineOn(deps, machine)
  const home = await homeOf(deps, on)
  const dir = home && underHome(path || home, home)
  if (!dir) throw new HerdrError('bad_path', fmt('Outside {home}', { home }))
  const parent = dir === home ? null : px.dirname(dir)
  const r = await exec(deps, on, LIST_DIRS_SCRIPT, [dir])
  const denied = dirDeniedFromCode(r.code)
  if (r.code !== 0 && !denied) throw new HerdrError('bad_path', fmt('Folder unreadable: {path}', { path: dir }))
  if (denied) return { path: dir, parent, home, dirs: [], denied, ...(on ? { remote: true } : {}) }
  const dirs: DirEntry[] = parseDirList(r.stdout).map(e => ({ name: e.name, path: px.join(dir, e.name), git: e.git }))
  dirs.sort((a, b) => (Number(b.git) - Number(a.git)) || a.name.localeCompare(b.name))
  return { path: dir, parent, home, dirs }
}

export async function coreIsGit(deps: CoreAdminDeps, path: string | null, machine: unknown) {
  const { on } = machineOn(deps, machine)
  const home = await homeOf(deps, on)
  const dir = home && underHome(path || home, home)
  if (!dir) return { git: false }
  return { git: (await exec(deps, on, 'test -e "$1/.git"', [dir])).code === 0 }
}

// Machines of the "New" sheet (only with several).
export async function coreMachineConfigs(deps: CoreAdminDeps): Promise<MachineConfig[] | undefined> {
  const ms = deps.machines()
  if (ms.length < 2) return undefined
  return Promise.all(ms.map(async (m) => {
    const online = m.local || m.status === 'online'
    const on = m.local ? undefined : m.label
    const [home, kinds] = online ? await Promise.all([homeOf(deps, on).catch(() => ''), kindsOf(deps, on).catch(() => [])]) : ['', []]
    return { key: m.key, label: m.label, local: m.local, home, kinds, dirs: await deps.recent(m), online: online && Boolean(home) }
  }))
}

export interface CreateBody { kind?: unknown, machine?: unknown, cwd?: unknown, name?: unknown }

// Creates a terminal ('shell') or an agent CLI in a folder. The result is only
// "uncertain" (never a blind second launch) when core did not answer in time and the
// correlation label finds nothing in the inventory.
export async function coreCreate(deps: CoreAdminDeps, body: CreateBody) {
  const kind = String(body.kind || '')
  if (kind !== 'shell' && !AGENT_KINDS.includes(kind)) throw new HerdrError('bad_kind', fmt('Unknown agent: {kind}', { kind }))
  const { m, on } = machineOn(deps, body.machine)
  if (kind !== 'shell' && !(await kindsOf(deps, on)).includes(kind)) throw new HerdrError('not_installed', fmt('{kind} is not installed on {machine}', { kind, machine: m.label }))
  const home = await homeOf(deps, on)
  const cwd = home && underHome(body.cwd || home, home)
  if (!cwd) throw new HerdrError('bad_cwd', fmt('The folder must be under {home}', { home }))
  if ((await exec(deps, on, 'test -d "$1"', [cwd])).code !== 0) throw new HerdrError('bad_cwd', fmt('Folder not found: {path}', { path: cwd }))
  const typed = cleanLabel(body.name)
  const name = toAgentName(typed)
  if (name && !NAME_RE.test(name)) throw new HerdrError('bad_name', 'Invalid name')
  const request = crypto.randomBytes(8).toString('hex')
  const params = {
    cwd, ...(on ? { on } : {}), ...(name ? { name } : {}), no_parent: true, wait: false,
    labels: { [REQUEST_LABEL]: request }, ...(kind === 'shell' ? {} : { line: `${PATH_SETUP}; exec ${kind}` }),
  }
  let address: string
  try {
    address = (await deps.call<{ address: string }>('terminal.run', params, 30000)).address
  } catch (e) {
    const kindOf = e instanceof CoreError ? e.kind : ''
    if (!['timeout', 'disconnected', 'protocol'].includes(kindOf)) return failure(e)
    // The program may exist: look for the request's label before saying anything.
    const found = await deps.call<{ terminals: { address: string, labels?: Record<string, string> }[] }>('terminal.list', { labels: true }, 8000)
      .then(r => r.terminals.find(t => t.labels?.[REQUEST_LABEL] === request)?.address, () => undefined)
    if (!found) throw new HerdrError('uncertain', 'herdr-core did not confirm: check the list before creating it again')
    address = found
  }
  await deps.remember(cwd, m).catch(() => {})
  await deps.settle()
  const pane = deps.panes().find(p => p.coreAddress === address)
  if (!pane) throw new HerdrError('uncertain', 'Created, but not in the list yet: check the list before creating it again')
  return { pane_id: pane.id, workspace_id: pane.workspace, name: kind === 'shell' ? null : name || kind }
}

// Adds a machine over SSH (like `hc machine add <target>`): no command (`via`) and no
// installation from here; the target is checked so that it can never be read as an ssh option.
export async function coreAddMachine(deps: CoreAdminDeps, body: { target?: unknown, name?: unknown }) {
  const target = typeof body.target === 'string' ? body.target.trim() : ''
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!TARGET_RE.test(target)) throw new HerdrError('bad_target', 'Invalid SSH target')
  if (name && !NAME_RE.test(name)) throw new HerdrError('bad_name', 'The name uses a-z, 0-9, - _ . (32 at most)')
  try {
    await deps.call('machine.add', { target, ...(name ? { name } : {}) }, 60000)
  } catch (e) {
    const kind = e instanceof CoreError ? e.kind : ''
    const text: Record<string, string> = {
      name_taken: 'A machine with this name already exists', already_added: 'This machine is already added',
      unreachable: 'The machine cannot be reached over SSH', hc_missing: 'herdr-core is not installed on that machine',
      incompatible: 'The herdr-core version of that machine is incompatible', invalid_params: 'Invalid machine',
    }
    if (text[kind]) throw new HerdrError(kind, text[kind]!)
    return failure(e)
  }
  await deps.settle()
  return { ok: true }
}

export async function coreConnectMachine(deps: CoreAdminDeps, key: unknown) {
  const m = deps.machines().find(x => x.key === String(key || '') && !x.local)
  if (!m) throw new HerdrError('bad_machine', 'unknown remote machine')
  try { await deps.call('machine.connect', { machine: m.label }, 60000) } catch (e) { return failure(e) }
  await deps.settle()
  return { ok: true }
}
