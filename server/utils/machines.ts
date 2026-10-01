// Several machines, like the Herdr client's sidebar: the local
// machine (socket ~/.config/herdr/herdr.sock) and the SSH machines registered
// in Herdr (`herdr machine add`, read with `herdr machine list --json`).
//
// Herdr's multi-machine support is client-side: the local server does not aggregate
// the others. So we connect to each one ourselves:
//  - one SSH master connection per machine (ControlMaster, control socket
//    in RUNTIME_DIR), which forwards the remote Herdr server's Unix socket
//    to RUNTIME_DIR/<machine>.sock. The line-delimited JSON client (herdr.ts) uses
//    it as is: snapshot every second, prompt, send_input, pane.read…
//  - file reads (transcripts, folders) and the terminal go
//    through sessions multiplexed over that same connection (no new
//    authentication, ~a few tens of ms per round trip).
//  - connection lost: reconnection with a bounded growing delay; a broken
//    machine never blocks the others (separate loops and sockets).
//
// Safeguards: we only read THIS machine's `herdr machine list` (never that
// of a remote machine: no recursion); a profile pointing at this machine
// itself (name, localhost, or same ~/.cache/herdr-web/machine-id identifier
// seen remotely) is ignored; two profiles to the same host and session
// count as one.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFile, spawn, type ChildProcess, type ChildProcessWithoutNullStreams } from 'node:child_process'
import type { MachineInfo, NamedSession } from '../../shared/types'
import { parseSessionList, sessionKey, validSession } from '../../shared/sessions'
import { LOCAL, type MachineProfile, parseMachineList, parseStatusSocket, splitId } from '../../shared/ids'
import {
  DATA_DIR, HERDR_BIN, HERDR_CHILD_ENV, HERDR_CLIENT_SOCK, HERDR_SESSION, HERDR_SOCK, HOME, HOST_LABEL, MACHINES_ENABLED, MACHINES_REFRESH_MS,
  REMOTE_SESSION, REMOTE_UPLOAD_SUBDIR, RUNTIME_DIR, SELF_HOSTS, SESSION_ARGS, SSH_BIN, UPLOAD_TTL_MS, log,
} from './env'
import { HerdrError, herdr, setSocketResolver } from './herdr'
import { type ExecResult, type MachineFs, type ShellExec, createShellFs, localFs, shq } from './fsx'
import { type Transcripts, createTranscripts } from './transcripts'
import { fmt } from '../../shared/message'

const fsp = fs.promises
const LOCAL_LABEL_FILE = path.join(DATA_DIR, 'machine-label.txt')
function readLocalLabel() {
  try { return fs.readFileSync(LOCAL_LABEL_FILE, 'utf8').trim().slice(0, 40) || HOST_LABEL }
  catch { return HOST_LABEL }
}
export const localMachineLabel = () => localMachine.label

export type MachineStatus = MachineInfo['status']

export interface Machine {
  key: string // '' = local; otherwise 8 hex characters of the Herdr profile
  profileId: string | null
  label: string
  local: boolean
  target: string | null
  session: string
  status: MachineStatus
  error: string | null
  home: string
  fs: MachineFs
  transcripts: Transcripts
  exec: ShellExec | null // commandes shell (machines distantes)
  sock: () => string | null
  // Herdr client socket (notifications, see herdrNotify.ts).
  clientSock: () => string | null
  // `herdr <args>` on the machine (terminal), stdin/stdout connected.
  spawnHerdr: (args: string[]) => ChildProcessWithoutNullStreams
  // Store for photos sent to this machine's agents.
  uploadDir: () => string
  info: () => MachineInfo
}

// ---------------------------------------------------------------- machine locale
export const localMachine: Machine = {
  key: LOCAL,
  profileId: null,
  label: readLocalLabel(),
  local: true,
  target: null,
  session: HERDR_SESSION || 'default',
  status: 'online',
  error: null,
  home: HOME,
  fs: localFs,
  transcripts: createTranscripts({ home: HOME, herdr }),
  exec: null,
  sock: () => HERDR_SOCK,
  clientSock: () => HERDR_CLIENT_SOCK,
  spawnHerdr: args => spawn(HERDR_BIN, [...SESSION_ARGS, ...args], { stdio: ['pipe', 'pipe', 'pipe'], env: HERDR_CHILD_ENV }),
  uploadDir: () => path.join(HOME, '.cache/herdr-web/uploads'),
  info: () => ({ key: LOCAL, session: localMachine.session, label: localMachine.label, local: true, status: 'online', error: null }),
}

// ---------------------------------------------------------------- identity
// Random identifier of this machine, in wherdr's folder: a remote machine
// that has the same one is this very machine (profile looping back to us).
const ID_FILE = path.join(HOME, '.cache/herdr-web/machine-id')
let selfId: string | null = null
export function localMachineId(): string {
  if (selfId) return selfId
  try { selfId = fs.readFileSync(ID_FILE, 'utf8').trim() || null }
  catch { /* not created yet */ }
  if (!selfId) {
    selfId = crypto.randomBytes(16).toString('hex')
    try {
      fs.mkdirSync(path.dirname(ID_FILE), { recursive: true })
      fs.writeFileSync(ID_FILE, selfId + '\n', { mode: 0o644 })
    } catch (e) { log(`machine-id: ${(e as Error).message}`) }
  }
  return selfId
}
// Names of this machine (profiles to ignore): HOST_LABEL, host name, HERDR_WEB_SELF_HOSTS.
export const selfNames = () => [HOST_LABEL, os.hostname(), ...SELF_HOSTS].filter(Boolean)

export class SkipMachine extends Error {}

// ---------------------------------------------------------------- SSH machines
// Probe: $HOME, herdr binary (not necessarily on the PATH of a non-interactive
// ssh), then `herdr [--session S] status server` (socket, state).
const PROBE_SCRIPT = `echo "home=$HOME"
echo "host=$(uname -n 2>/dev/null)"
echo "self=$(cat "$HOME/.cache/herdr-web/machine-id" 2>/dev/null)"
b=
for c in "$HOME/.local/bin/herdr" /opt/homebrew/bin/herdr /usr/local/bin/herdr; do
  if [ -x "$c" ]; then b=$c; break; fi
done
[ -n "$b" ] || b=$(command -v herdr 2>/dev/null)
if [ -z "$b" ]; then echo "error=herdr not found"; exit 0; fi
echo "bin=$b"
if [ -n "$1" ]; then "$b" --session "$1" status server 2>&1; else "$b" status server 2>&1; fi`

const UPLOAD_SCRIPT = `umask 077
d="$HOME/${REMOTE_UPLOAD_SUBDIR}"
mkdir -p "$d" && cat > "$d/$1" && echo "$d/$1"`

const PURGE_SCRIPT = `d="$HOME/${REMOTE_UPLOAD_SUBDIR}"
[ -d "$d" ] && find "$d" -type f -mtime +${Math.round(UPLOAD_TTL_MS / 86400000)} -exec rm -f {} + ; exit 0`

// Reconnection delays (bounded), then every 30 s.
const BACKOFF_MS = [1000, 2000, 5000, 10000, 20000, 30000]
// Beyond this number of consecutive failures, the machine goes "offline".
const FAILS_BEFORE_OFFLINE = 2

function runFile(bin: string, args: string[], timeoutMs: number): Promise<ExecResult> {
  return new Promise((resolve) => {
    execFile(bin, args, { timeout: timeoutMs, encoding: 'buffer', maxBuffer: 1024 * 1024, env: HERDR_CHILD_ENV }, (err, stdout, stderr) => {
      const raw = err ? (err as { code?: unknown }).code : 0
      const code = typeof raw === 'number' ? raw : err ? 1 : 0
      resolve({ code, stdout: stdout as Buffer, stderr: String(stderr || (err && err.message) || '') })
    })
  })
}

const lastLine = (s: string) => String(s || '').trim().split('\n').filter(Boolean).pop() || ''

export class RemoteMachine implements Machine {
  readonly key: string
  baseKey?: string
  profileId: string
  label: string
  target: string
  profileSession: string
  readonly local = false
  status: MachineStatus = 'connecting'
  error: string | null = null
  home = ''
  bin = ''
  remoteSock = ''
  readonly ctl: string
  readonly fwd: string
  readonly fwdClient: string
  private clientFwd = false
  fs: MachineFs
  transcripts: Transcripts
  exec: ShellExec
  private master: ChildProcess | null = null
  private masterErr: string[] = []
  private fails = 0
  private timer: ReturnType<typeof setTimeout> | null = null
  private purgeTimer: ReturnType<typeof setInterval> | null = null
  private stopped = false
  private connecting = false
  private pollFails = 0
  // Identity seen at connection (host name + remote socket): duplicates.
  ident = ''
  private onChange: () => void
  onSkip: (m: RemoteMachine, reason: string) => void = () => {}
  onOnline: (m: RemoteMachine) => void = () => {}

  constructor(p: MachineProfile, onChange: () => void) {
    this.key = p.key
    this.profileId = p.id
    this.label = p.label
    this.target = p.target
    this.profileSession = p.session
    this.onChange = onChange
    this.ctl = path.join(RUNTIME_DIR, `${p.key}.ctl`)
    this.fwd = path.join(RUNTIME_DIR, `${p.key}.sock`)
    this.fwdClient = path.join(RUNTIME_DIR, `${p.key}.client.sock`)
    this.exec = (script, args = [], opts = {}) => this.run(script, args, opts)
    this.fs = createShellFs(this.exec)
    this.transcripts = createTranscripts({ home: '/', herdr, fs: this.fs })
  }

  get session() { return this.baseKey ? this.profileSession : REMOTE_SESSION || this.profileSession }
  sock() { return this.status === 'online' ? this.fwd : null }
  clientSock() { return this.status === 'online' && this.clientFwd ? this.fwdClient : null }
  uploadDir() { return path.posix.join(this.home || '~', REMOTE_UPLOAD_SUBDIR) }
  info(): MachineInfo {
    return { key: this.key, baseKey: this.baseKey, session: this.session, label: this.label, local: false, status: this.status, error: this.error, target: this.target }
  }

  // Common options of multiplexed sessions: never a new connection
  // (ProxyCommand=false if the master is missing), never a question.
  private muxArgs() {
    return ['-S', this.ctl, '-o', 'ControlMaster=no', '-o', 'BatchMode=yes', '-o', 'ProxyCommand=/bin/false', '-T']
  }

  private run(script: string, args: string[], opts: { input?: Buffer, timeoutMs?: number }): Promise<ExecResult> {
    if (this.status !== 'online' && !this.connecting) {
      return Promise.resolve({ code: 255, stdout: Buffer.alloc(0), stderr: fmt('{machine} is unreachable', { machine: this.label }) })
    }
    const cmd = `sh -c ${shq(script)} sh ${args.map(shq).join(' ')}`
    return new Promise((resolve) => {
      const child = spawn(SSH_BIN, [...this.muxArgs(), '--', this.target, cmd], { stdio: ['pipe', 'pipe', 'pipe'] })
      const out: Buffer[] = []
      let err = ''
      let done = false
      const finish = (code: number | null) => {
        if (done) return
        done = true
        clearTimeout(timer)
        resolve({ code, stdout: Buffer.concat(out), stderr: err })
      }
      const timer = setTimeout(() => {
        err += '\n'
        err += 'timed out'
        child.kill('SIGKILL')
        finish(124)
      }, opts.timeoutMs || 15000)
      child.stdout.on('data', (b: Buffer) => out.push(b))
      child.stderr.on('data', (b: Buffer) => { if (err.length < 4000) err += b.toString('utf8') })
      child.on('error', (e) => { err += e.message; finish(127) })
      child.on('close', code => finish(code))
      child.stdin.on('error', () => {})
      child.stdin.end(opts.input || undefined)
    })
  }

  spawnHerdr(args: string[]): ChildProcessWithoutNullStreams {
    const sess = this.session && this.session !== 'default' ? ['--session', this.session] : []
    const cmd = `exec ${[this.bin || 'herdr', ...sess, ...args].map(shq).join(' ')}`
    return spawn(SSH_BIN, [...this.muxArgs(), '--', this.target, cmd], { stdio: ['pipe', 'pipe', 'pipe'] })
  }

  async putUpload(name: string, data: Buffer): Promise<string> {
    const r = await this.exec(UPLOAD_SCRIPT, [name], { input: data, timeoutMs: 60000 })
    const p = r.stdout.toString('utf8').trim()
    if (r.code !== 0 || !p) throw new Error(fmt('Copy to {machine} failed: {reason}', { machine: this.label, reason: lastLine(r.stderr) || r.code }))
    return p
  }

  private set(status: MachineStatus, error: string | null) {
    if (this.status === status && this.error === error) return
    this.status = status
    this.error = error
    log(`machine ${this.label} (${this.target}): ${status}${error ? ` — ${error}` : ''}`)
    this.onChange()
  }

  start() {
    this.stopped = false
    this.connect()
  }

  stop() {
    this.stopped = true
    if (this.timer) clearTimeout(this.timer)
    if (this.purgeTimer) clearInterval(this.purgeTimer)
    this.timer = null
    this.purgeTimer = null
    this.killMaster()
  }

  // Restarts the connection (target or session changed, silent remote server…).
  restart(reason: string) {
    if (this.stopped) return
    log(`machine ${this.label}: reconnecting (${reason})`)
    this.killMaster()
    this.fail(reason)
  }

  private killMaster() {
    const m = this.master
    this.master = null
    // Stop by exact PID: the ssh master process we started.
    if (m && m.exitCode === null) m.kill('SIGTERM')
    this.clientFwd = false
    fsp.unlink(this.fwd).catch(() => {})
    fsp.unlink(this.fwdClient).catch(() => {})
  }

  private fail(error: string) {
    if (this.stopped) return
    this.fails++
    this.set(this.fails > FAILS_BEFORE_OFFLINE ? 'offline' : 'connecting', error)
    const delay = BACKOFF_MS[Math.min(this.fails - 1, BACKOFF_MS.length - 1)]!
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => this.connect(), delay)
  }

  // State polling (state.ts): the remote server may stop while
  // the SSH connection holds. Three consecutive failures: start over.
  reportPoll(ok: boolean, error?: string) {
    if (ok) { this.pollFails = 0; return }
    if (this.status !== 'online') return
    if (++this.pollFails >= 3) {
      this.pollFails = 0
      this.restart(error || 'Herdr server not responding')
    }
  }

  private async waitControl(child: ChildProcess, timeoutMs: number) {
    const until = Date.now() + timeoutMs
    while (Date.now() < until) {
      if (child.exitCode !== null || this.master !== child) return false
      const r = await runFile(SSH_BIN, ['-S', this.ctl, '-O', 'check', '--', this.target], 5000)
      if (r.code === 0) return true
      await new Promise(res => setTimeout(res, 250))
    }
    return false
  }

  private async connect() {
    if (this.stopped || this.connecting) return
    this.connecting = true
    this.timer = null
    try {
      await fsp.mkdir(RUNTIME_DIR, { recursive: true, mode: 0o700 })
      await fsp.unlink(this.ctl).catch(() => {})
      await fsp.unlink(this.fwd).catch(() => {})
      await fsp.unlink(this.fwdClient).catch(() => {})
      if (this.status !== 'offline') this.set('connecting', this.error)
      this.masterErr = []
      const child = spawn(SSH_BIN, [
        '-M', '-S', this.ctl, '-N', '-T',
        '-o', 'ControlPersist=no', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10',
        '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=3',
        '-o', 'ExitOnForwardFailure=yes', '-o', 'StreamLocalBindUnlink=yes',
        '--', this.target,
      ], { stdio: ['ignore', 'ignore', 'pipe'] })
      this.master = child
      child.stderr!.setEncoding('utf8')
      child.stderr!.on('data', (s: string) => {
        for (const l of s.split('\n').map(x => x.trim()).filter(Boolean)) {
          this.masterErr.push(l)
          if (this.masterErr.length > 6) this.masterErr.shift()
        }
      })
      child.on('error', e => this.masterErr.push(e.message))
      child.on('exit', (code) => {
        if (this.master !== child) return
        this.master = null
        const why = this.masterErr.filter(l => !/^Warning: Permanently added/.test(l)).pop() || fmt('SSH connection closed (code {code})', { code })
        if (!this.connecting) this.fail(why)
      })

      if (!(await this.waitControl(child, 20000))) {
        throw new Error(this.masterErr.filter(l => !/^Warning:/.test(l)).pop() || 'SSH connection failed (timed out)')
      }
      // Probe (over the multiplexed connection).
      const probe = await this.exec(PROBE_SCRIPT, [this.session === 'default' ? '' : this.session], { timeoutMs: 15000 })
      const out = probe.stdout.toString('utf8')
      const kv = (k: string) => (new RegExp(`^${k}=(.*)$`, 'm').exec(out) || [])[1] || ''
      if (probe.code !== 0) throw new Error(lastLine(probe.stderr) || fmt('Probe failed (code {code})', { code: probe.code }))
      if (kv('self') && kv('self') === localMachineId()) throw new SkipMachine('this machine itself')
      if (kv('error')) throw new Error(fmt('{reason} on {machine}', { reason: kv('error'), machine: this.label }))
      this.home = kv('home')
      this.bin = kv('bin')
      const running = /^\s*status:\s*running\s*$/m.test(out)
      const sock = parseStatusSocket(out)
      if (!running || !sock) {
        throw new Error(this.session !== 'default' ? fmt('Herdr server stopped on {machine} (session {session})', { machine: this.label, session: this.session }) : fmt('Herdr server stopped on {machine}', { machine: this.label }))
      }
      this.remoteSock = sock
      this.ident = `${kv('host').toLowerCase()}|${sock}`
      this.transcripts = createTranscripts({ home: this.home, herdr, fs: this.fs })
      // Transfert du socket Unix distant vers RUNTIME_DIR/<machine>.sock.
      const fwd = await runFile(SSH_BIN, ['-S', this.ctl, '-O', 'forward', '-L', `${this.fwd}:${sock}`, '--', this.target], 10000)
      if (fwd.code !== 0) throw new Error(fmt('Herdr socket forwarding failed: {reason}', { reason: lastLine(fwd.stderr) || fwd.code }))
      // Client socket (notifications): optional, the machine stays usable without it.
      const clientSock = path.posix.join(path.posix.dirname(sock), 'herdr-client.sock')
      const fwdc = await runFile(SSH_BIN, ['-S', this.ctl, '-O', 'forward', '-L', `${this.fwdClient}:${clientSock}`, '--', this.target], 10000)
      this.clientFwd = fwdc.code === 0
      if (!this.clientFwd) log(`machine ${this.label}: herdr notifications unavailable (${lastLine(fwdc.stderr) || fwdc.code})`)
      if (this.master !== child || child.exitCode !== null) throw new Error('SSH connection closed')
      this.fails = 0
      this.pollFails = 0
      this.connecting = false
      this.set('online', null)
      this.onOnline(this)
      if (this.stopped) return
      this.purgeUploads()
      if (!this.purgeTimer) this.purgeTimer = setInterval(() => this.purgeUploads(), 6 * 3600 * 1000)
    } catch (e) {
      this.connecting = false
      this.killMaster()
      if (e instanceof SkipMachine) {
        this.stop()
        this.onSkip(this, e.message)
        return
      }
      this.fail((e as Error).message)
    } finally {
      this.connecting = false
    }
  }

  private purgeUploads() {
    this.exec(PURGE_SCRIPT, [], { timeoutMs: 20000 }).catch(() => {})
  }
}

// ---------------------------------------------------------------- registre
const remotes = new Map<string, RemoteMachine>()
const sessions = new Map<string, Machine>()
// Profiles dropped after connection (this machine, or duplicate): key -> target|session.
const skipped = new Map<string, string>()
const sig = (p: { target: string, profileSession?: string, session?: string }) => `${p.target}|${p.profileSession ?? p.session}`
function skip(m: RemoteMachine, reason: string) {
  m.stop()
  for (const [key, other] of sessions) if (other instanceof RemoteMachine && other.baseKey === m.key) {
    other.stop()
    sessions.delete(key)
  }
  skipped.set(m.key, sig(m))
  if (remotes.get(m.key) === m) remotes.delete(m.key)
  log(`machine ${m.label} (${m.target}) ignored: ${reason}`)
  changed()
}
// Same host and same socket as an already connected machine (other name, IP…): duplicate.
function checkDuplicate(m: RemoteMachine) {
  for (const o of remotes.values()) {
    if (o === m || !o.ident || o.ident !== m.ident) continue
    return skip(m, `same machine as ${o.label}`)
  }
}
const listeners = new Set<() => void>()
const changed = () => { for (const f of listeners) f() }
export function onMachinesChange(fn: () => void) { listeners.add(fn) }

export const allMachines = (): Machine[] => [localMachine, ...remotes.values(), ...sessions.values()]
export const baseMachines = (): Machine[] => [localMachine, ...remotes.values()]
export const remoteMachines = () => [...remotes.values()]
export const getMachine = (key: string | null | undefined): Machine | undefined =>
  (!key ? localMachine : remotes.get(key) || sessions.get(key))
export const machineOfPane = (id: string | null | undefined) => getMachine(splitId(String(id || '')).machine)
export const multiMachine = () => remotes.size > 0 || sessions.size > 0

export async function listSessions(baseKey: string): Promise<NamedSession[]> {
  const m = baseMachines().find(x => x.key === baseKey)
  if (!m) throw new HerdrError('bad_machine', 'unknown machine')
  let r: ExecResult
  if (m.local) r = await runFile(HERDR_BIN, ['session', 'list', '--json'], 10000)
  else {
    const remote = m as RemoteMachine
    if (remote.status !== 'online') throw new HerdrError('unreachable', fmt('{machine} is unreachable', { machine: m.label }))
    r = await remote.exec('"$1" session list --json', [remote.bin], { timeoutMs: 10000 })
  }
  if (r.code !== 0) throw new HerdrError('session_list', lastLine(r.stderr) || 'Session list unavailable')
  return parseSessionList(r.stdout.toString('utf8'), baseKey, m.session)
}

export async function openSession(baseKey: string, name: string): Promise<NamedSession> {
  if (!validSession(name)) throw new HerdrError('bad_session', 'Invalid session')
  const found = (await listSessions(baseKey)).find(s => s.name === name)
  if (!found || !found.running) throw new HerdrError('session_stopped', 'Session missing or stopped')
  if (found.key === baseKey) return found
  if (sessions.has(found.key)) return found
  const base = baseMachines().find(m => m.key === baseKey)!
  if (base.local) {
    const sockDir = path.join(HOME, '.config/herdr/sessions', name)
    const machine: Machine = {
      ...localMachine, key: found.key, local: true, session: name,
      sock: () => path.join(sockDir, 'herdr.sock'),
      clientSock: () => path.join(sockDir, 'herdr-client.sock'),
      spawnHerdr: args => spawn(HERDR_BIN, ['--session', name, ...args], { stdio: ['pipe', 'pipe', 'pipe'], env: HERDR_CHILD_ENV }),
      transcripts: createTranscripts({ home: HOME, herdr }),
      info: () => ({ key: found.key, baseKey, session: name, label: localMachine.label, local: true, status: 'online', error: null }),
    }
    sessions.set(found.key, machine)
  } else {
    const remote = base as RemoteMachine
    const profile: MachineProfile = { key: found.key, id: remote.profileId, label: remote.label, target: remote.target, session: name }
    const machine = new RemoteMachine(profile, changed)
    machine.baseKey = baseKey
    machine.onSkip = () => { machine.stop(); sessions.delete(found.key); changed() }
    sessions.set(found.key, machine)
    machine.start()
  }
  changed()
  return found
}

setSocketResolver((key) => {
  const m = getMachine(key)
  if (!m) return { sock: null, error: fmt('Unknown machine: {machine}', { machine: key }) }
  const sock = m.sock()
  return sock ? { sock } : { sock: null, error: m.error ? fmt('{machine} is unreachable: {reason}', { machine: m.label, reason: m.error }) : fmt('{machine} is unreachable', { machine: m.label }) }
})

// Re-reads Herdr's profiles: adds, removes, renames without restarting.
// First read of the profiles done (successful or not): the state can say it is ready.
let listed = false
export const machinesListed = () => listed || !MACHINES_ENABLED
export async function refreshMachines() {
  if (!MACHINES_ENABLED) return
  try { await readMachines() }
  finally {
    if (!listed) { listed = true; changed() }
  }
}
async function readMachines() {
  const r = await runFile(HERDR_BIN, ['machine', 'list', '--json'], 10000)
  if (r.code !== 0) {
    log(`herdr machine list: ${lastLine(r.stderr) || r.code}`)
    return
  }
  // This machine's profiles only; those pointing at itself are dropped.
  const profiles = parseMachineList(r.stdout.toString('utf8'), selfNames())
    .filter(p => skipped.get(p.key) !== sig(p))
  let dirty = false
  const keep = new Set(profiles.map(p => p.key))
  for (const [k, m] of remotes) {
    if (keep.has(k)) continue
    m.stop()
    remotes.delete(k)
    for (const [sk, sm] of sessions) if (sm instanceof RemoteMachine && sm.baseKey === k) { sm.stop(); sessions.delete(sk) }
    log(`machine ${m.label} removed`)
    dirty = true
  }
  for (const p of profiles) {
    const m = remotes.get(p.key)
    if (!m) {
      const nm = new RemoteMachine(p, changed)
      nm.onSkip = skip
      nm.onOnline = checkDuplicate
      remotes.set(p.key, nm)
      log(`machine ${p.label} (${p.target}, session ${REMOTE_SESSION || p.session}) added`)
      nm.start()
      dirty = true
      continue
    }
    if (m.label !== p.label) {
      m.label = p.label
      for (const other of sessions.values()) if (other instanceof RemoteMachine && other.baseKey === m.key) other.label = p.label
      dirty = true
    }
    if (m.target !== p.target || m.profileSession !== p.session) {
      m.target = p.target
      m.profileSession = p.session
      m.restart('profile changed')
      for (const sm of sessions.values()) if (sm instanceof RemoteMachine && sm.baseKey === m.key) {
        sm.target = p.target
        sm.restart('profile changed')
      }
      dirty = true
    }
  }
  // Ordre du profil Herdr.
  const order = profiles.map(p => p.key)
  const sorted = [...remotes.entries()].sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]))
  remotes.clear()
  for (const [k, m] of sorted) remotes.set(k, m)
  if (dirty) changed()
}

export async function renameMachine(key: string, label: string) {
  if (!label) throw new HerdrError('bad_label', 'Empty machine name')
  if (key === LOCAL) {
    await fsp.mkdir(DATA_DIR, { recursive: true })
    await fsp.writeFile(LOCAL_LABEL_FILE, `${label}\n`, 'utf8')
    localMachine.label = label
    for (const other of sessions.values()) if (!(other instanceof RemoteMachine)) other.label = label
    changed()
    return
  }
  const m = remotes.get(key)
  if (!m) throw new HerdrError('bad_machine', 'unknown machine')
  const r = await runFile(HERDR_BIN, ['machine', 'rename', m.profileId, '--label', label], 10000)
  if (r.code !== 0) throw new HerdrError('machine_rename', lastLine(r.stderr) || 'Rename failed')
  m.label = label
  for (const other of sessions.values()) if (other instanceof RemoteMachine && other.baseKey === key) other.label = label
  changed()
  await refreshMachines()
}

let refreshTimer: ReturnType<typeof setInterval> | null = null
export function startMachines() {
  if (!MACHINES_ENABLED) return
  localMachineId()
  refreshMachines().catch(e => log('machines:', e.message))
  refreshTimer = setInterval(() => refreshMachines().catch(e => log('machines:', e.message)), MACHINES_REFRESH_MS)
}
export function stopMachines() {
  if (refreshTimer) clearInterval(refreshTimer)
  for (const m of remotes.values()) m.stop()
  for (const m of sessions.values()) if (m instanceof RemoteMachine) m.stop()
}
process.on('exit', () => { for (const m of [...remotes.values(), ...sessions.values()]) if (m instanceof RemoteMachine) m.stop() })
