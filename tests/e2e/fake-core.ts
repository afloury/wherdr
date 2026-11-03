// Fake herdr-core harness for the v3 e2e specs (tests/e2e/core-*.spec.ts, run by
// playwright.core.config.ts). Each test gets its own built server (.output/, built with
// `WHERDR_BACKEND=core NUXT_PUBLIC_CORE=true npm run build`), an empty data dir, a fake
// HOME holding the agents' conversation files, and a scripted core socket:
//
//   const claude = core.claude('acme-api', [['user', 'Hi'], ['assistant', 'Hello.']])
//   await page.goto(claude.url)
//
// The core answers JSON-RPC on one-shot connections (inventory, terminal.get/read/send/keys…)
// and the framed protocol for the live terminal (events.subscribe + terminal.attach). It
// records what the app sent (`sends`, `keys`, `typed`, `puts`) so a spec can check it, and an
// agent with a `reply` answers each message by appending to its conversation file, as a
// real Claude Code or Codex would. No events session: the server reads the inventory again
// on every poll (1 s), so a change made here shows within a poll.
import { test as base, expect } from '@playwright/test'
import { spawn, type ChildProcess } from 'node:child_process'
import { createServer, type Server, type Socket } from 'node:net'
import fs from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pdfAuthDb, pdfSession } from './pdfAuth.mjs'
import fixture from '../fixtures/core-0.1.16.json' with { type: 'json' }

export * from '@playwright/test'

export type Role = 'user' | 'assistant'
export type Turn = [Role, string]
export type Status = 'idle' | 'working' | 'blocked' | 'done' | null

const RULE = '─'.repeat(60)
/** Claude Code's input box as core's plain screen shows it (`draft`: text left in the field). */
export const claudeScreen = (draft = '') => `${RULE}\n❯ ${draft}\n${RULE}\n  ? for shortcuts`
const CODEX_SCREEN = '› Ask Codex to do anything\n\n  GPT-6-Sol medium · ~/project'
/** A fixture of tests/fixtures (screens of real agents). */
export const screenFixture = (name: string) => fs.readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8')

// Same ids as shared/coreState.ts: hex of the address and of the folder.
const key = (value: string) => Buffer.from(value, 'utf8').toString('hex')
const iso = (ms: number) => new Date(ms).toISOString()

export interface AgentOptions {
  /** Terminal name (the card title); the folder name by default. */
  name?: string
  status?: Status
  /** Screen text (terminal.read and the attached terminal); an empty input box by default. */
  screen?: string
  /** Text appended as the agent's answer to each message; null: the message is only recorded. */
  reply?: string | null
}

export interface FakeTerminal {
  address: string
  agent: 'claude' | 'codex' | null
  cwd: string
  pane: string
  /** `/#/a/<pane>` */
  url: string
  /** Messages core received (terminal.send), in order. */
  sends: string[]
  /** Named keys core received (terminal.keys), in order; cleared by setScreen. */
  keys: string[]
  /** Raw bytes typed in the attached terminal, as text. */
  typed: string
  /** Size of the attached terminal, when one is attached. */
  size: { cols: number, rows: number, attached: boolean }
  /** Appends a message to the agent's conversation file. */
  append: (role: Role, text: string) => void
  /** Appends a raw line (e.g. Claude's `queue-operation`) to the conversation file. */
  appendLine: (line: object) => void
  /** Replaces the screen; `transitions`: screens a key leads to (`{ enter: '…' }`). */
  setScreen: (text: string, status?: Status, transitions?: Record<string, string>) => void
  setStatus: (status: Status) => void
}

interface Internal extends FakeTerminal {
  pid: number
  created: number
  name: string
  status: Status
  screen: string
  reply: string | null
  transitions: Record<string, string>
  file: string | null
}

export class FakeCore {
  readonly terminals: Internal[] = []
  /** Every call the app made, one-shot and framed. */
  readonly calls: { method: string, params: Record<string, unknown> }[] = []
  /** terminal.put calls: file name and decoded content. */
  readonly puts: { terminal: string, name: string, data: Buffer }[] = []
  private nextPid = 4200
  private nextChannel = 10
  private streams = new Map<number, { t: Internal, socket: Socket }>()

  constructor(readonly home: string, readonly base: string) {}

  /** A Claude Code terminal in ~/projects/<folder>, its conversation made of `turns`. */
  claude(folder: string, turns: Turn[] = [], opts: AgentOptions = {}) { return this.add('claude', folder, turns, opts) }
  /** A Codex terminal in ~/projects/<folder>. */
  codex(folder: string, turns: Turn[] = [], opts: AgentOptions = {}) { return this.add('codex', folder, turns, opts) }
  /** A plain shell. */
  shell(folder: string, opts: AgentOptions = {}) { return this.add(null, folder, [], opts) }

  /** Path under the fake HOME's project folder (for files an agent's folder holds). */
  folder(name: string) { return path.join(this.home, 'projects', name) }

  private add(agent: Internal['agent'], folder: string, turns: Turn[], opts: AgentOptions): FakeTerminal {
    const cwd = this.folder(folder)
    fs.mkdirSync(cwd, { recursive: true })
    const n = this.terminals.length + 1
    const address = `t${n}`
    const workspace = `w${key(cwd)}`
    const pane = `${workspace}:p${key(address)}`
    const now = Date.now()
    const pid = this.nextPid++
    const t: Internal = {
      address, agent, cwd, pane, url: `/#/a/${pane}`, sends: [], keys: [], typed: '', size: { cols: 80, rows: 24, attached: false },
      pid, created: now - 30_000, name: opts.name ?? folder, status: opts.status === undefined ? (agent ? 'idle' : null) : opts.status,
      screen: opts.screen ?? (agent === 'claude' ? claudeScreen() : agent === 'codex' ? CODEX_SCREEN : '$ '),
      reply: opts.reply === undefined ? null : opts.reply, transitions: {}, file: null,
      append: (role, text) => this.append(t, role, text),
      appendLine: (line) => {
        if (!t.file) throw new Error(`${t.address} has no conversation`)
        fs.appendFileSync(t.file, JSON.stringify(line) + '\n')
      },
      setScreen: (text, status, transitions = {}) => {
        t.screen = text
        t.keys = []
        t.transitions = transitions
        if (status !== undefined) t.status = status
      },
      setStatus: (status) => { t.status = status },
    }
    if (agent === 'claude') {
      const sid = `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
      t.file = path.join(this.home, '.claude/projects', cwd.replace(/[^A-Za-z0-9]/g, '-'), `${sid}.jsonl`)
      write(path.join(this.home, '.claude/sessions', `${pid}.json`), JSON.stringify({ pid, sessionId: sid, cwd }))
      write(t.file, '')
    } else if (agent === 'codex') {
      const id = `00000000-0000-4000-8000-${String(1000 + n).padStart(12, '0')}`
      const day = iso(now).slice(0, 10)
      t.file = path.join(this.home, '.codex/sessions', ...day.split('-'), `rollout-${day}T00-00-00-${id}.jsonl`)
      write(t.file, JSON.stringify({ type: 'session_meta', payload: { id, cwd, timestamp: iso(t.created + 2000), thread_source: 'user' } }) + '\n')
    }
    turns.forEach(([role, text], i) => this.append(t, role, text, now - 60_000 + i * 1000))
    this.terminals.push(t)
    return t
  }

  private append(t: Internal, role: Role, text: string, at = Date.now()) {
    if (!t.file) throw new Error(`${t.address} has no conversation`)
    const sid = path.basename(t.file, '.jsonl')
    const line = t.agent === 'claude'
      ? { isSidechain: false, cwd: t.cwd, sessionId: sid, type: role, timestamp: iso(at), uuid: `${sid}-${at}-${role}`,
          message: role === 'user' ? { role, content: text } : { model: 'claude-opus-4-1', role, content: [{ type: 'text', text }] } }
      : { type: 'response_item', timestamp: iso(at), payload: { type: 'message', role, content: [{ type: role === 'user' ? 'input_text' : 'output_text', text }] } }
    fs.appendFileSync(t.file, JSON.stringify(line) + '\n')
  }

  private find(address: unknown) {
    const t = this.terminals.find(x => x.address === address)
    if (!t) throw Object.assign(new Error('no such terminal'), { kind: 'not_found' })
    return t
  }

  private inventory(t: Internal) {
    return { address: t.address, name: t.name, cwd: t.cwd, state: 'live', template: t.agent ?? 'shell', labels: {},
      argv: [t.agent ?? 'bash'], created_ms: t.created, screen: 'exact', cols: t.size.cols, rows: t.size.rows,
      status: t.status ? { state: t.status, app: t.agent } : null }
  }

  private timers = new Set<ReturnType<typeof setTimeout>>()
  private closed = false
  /** Runs `fn` in `ms` unless the test ended meanwhile. */
  later(ms: number, fn: () => void) {
    const timer = setTimeout(() => { this.timers.delete(timer); if (!this.closed) fn() }, ms)
    this.timers.add(timer)
  }
  close() {
    this.closed = true
    for (const timer of this.timers) clearTimeout(timer)
  }

  private async onSend(t: Internal, text: string) {
    t.sends.push(text)
    // Like core, the call returns once the text is typed and submitted.
    await new Promise(resolve => this.later(800, () => resolve(null)))
    if (t.reply === null || !t.file) return
    const reply = t.reply
    // Written to the conversation a moment later, answered a moment after.
    this.later(200, () => {
      this.append(t, 'user', text)
      t.status = 'working'
      this.later(600, () => { this.append(t, 'assistant', reply); t.status = 'idle' })
    })
  }

  /** One JSON-RPC call (one-shot or framed). Throws `{ kind }` for a core error. */
  async rpc(method: string, params: Record<string, unknown>, socket?: Socket): Promise<unknown> {
    this.calls.push({ method, params })
    switch (method) {
      case 'hello': return { ...fixture.hello, framed: Boolean(params.framed) }
      case 'rpc.discover': return fixture.discover
      case 'terminal.list': return { terminals: this.terminals.map(t => this.inventory(t)), machines: [], hidden_finished: 0 }
      case 'machine.list': return { machines: [] }
      case 'doc.get': return { value: null, version: 0 }
      case 'server.status': return { core: { id: 'fake', name: 'devbox' }, version: fixture.hello.version, pid: 1, uptime_ms: 60_000, holders: [], live: this.terminals.length, finished: 0 }
      case 'terminal.get': {
        const t = this.find(params.terminal)
        const proc = { pid: t.pid, name: t.agent ?? 'bash', argv: [t.agent ?? 'bash'] }
        return { ...this.inventory(t), pid: t.pid, foreground: proc, keep: false }
      }
      case 'terminal.read': return { text: this.find(params.terminal).screen }
      case 'terminal.send': {
        const t = this.find(params.terminal)
        await this.onSend(t, String(params.text ?? ''))
        return { started: true }
      }
      case 'terminal.keys': {
        const t = this.find(params.terminal)
        for (const k of params.keys as string[]) {
          t.keys.push(k)
          if (t.transitions[k] !== undefined) { t.screen = t.transitions[k]!; t.transitions = {} }
        }
        return {}
      }
      case 'terminal.interrupt': this.find(params.terminal).status = 'idle'; return { outcome: 'stopped' }
      case 'terminal.put': {
        const t = this.find(params.terminal)
        const name = String(params.name)
        this.puts.push({ terminal: t.address, name, data: Buffer.from(String(params.data ?? ''), 'base64') })
        return { path: path.join(t.cwd, '.herdr-uploads', name) }
      }
      case 'terminal.label': case 'terminal.keep': return {}
      case 'machine.exec': return { code: 0, stdout: '', stderr: '' }
      case 'events.subscribe': {
        if (!socket || !params.terminal) throw Object.assign(new Error('no events session here'), { kind: 'incompatible' })
        const t = this.find(params.terminal)
        return { channel: this.nextChannel++, seq: 1, terminals: [this.inventory(t)] }
      }
      case 'terminal.attach': {
        const t = this.find(params.terminal)
        const channel = this.nextChannel++
        t.size = { cols: Number(params.cols) || t.size.cols, rows: Number(params.rows) || t.size.rows, attached: true }
        this.streams.set(channel, { t, socket: socket! })
        setTimeout(() => socket?.write(frame(channel, 0, Buffer.from(t.screen.replace(/\n/g, '\r\n')))), 20)
        return { channel }
      }
      default: throw Object.assign(new Error(`${method} is not faked`), { kind: 'unsupported' })
    }
  }

  /** A framed frame from the server on an attach channel. */
  onFrame(channel: number, kind: number, payload: Buffer) {
    const s = this.streams.get(channel)
    if (!s) return
    if (kind === 0) s.t.typed += payload.toString('utf8')
    else if (kind === 2) { s.t.size = { ...s.t.size, attached: false }; this.streams.delete(channel) }
    else if (kind === 3 && payload.length >= 4) s.t.size = { cols: payload.readUInt16LE(0), rows: payload.readUInt16LE(2), attached: true }
  }

  dropSocket(socket: Socket) {
    for (const [channel, s] of this.streams) {
      if (s.socket !== socket) continue
      s.t.size = { ...s.t.size, attached: false }
      this.streams.delete(channel)
    }
  }
}

function write(file: string, content: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, content)
}

// Framed relay: [channel u32][kind u8][len u32][payload].
function frame(channel: number, kind: number, payload: Buffer) {
  const head = Buffer.alloc(9)
  head.writeUInt32LE(channel, 0)
  head.writeUInt8(kind, 4)
  head.writeUInt32LE(payload.length, 5)
  return Buffer.concat([head, payload])
}

const reply = (id: unknown, r: { result?: unknown, error?: { kind?: string, message?: string } }) => JSON.stringify(r.error
  ? { jsonrpc: '2.0', id, error: { code: -32000, message: r.error.message || 'error', data: { kind: r.error.kind || 'rpc' } } }
  : { jsonrpc: '2.0', id, result: r.result })

async function answer(core: FakeCore, call: { id?: unknown, method: string, params?: Record<string, unknown> }, socket?: Socket) {
  try { return reply(call.id, { result: await core.rpc(call.method, call.params ?? {}, socket) }) }
  catch (e) { return reply(call.id, { error: e as { kind?: string, message?: string } }) }
}

function serveCore(core: FakeCore, socketPath: string): Promise<Server> {
  const server = createServer(socket => {
    socket.on('error', () => {})
    socket.once('data', async (first) => {
      const text = first.toString('utf8')
      const call = JSON.parse(text.slice(0, text.indexOf('\n')))
      if (call.method === 'hello' && call.params?.framed) {
        socket.write(await answer(core, call) + '\n')
        let buf: Buffer = first.subarray(Buffer.byteLength(text.slice(0, text.indexOf('\n') + 1)))
        const drain = async () => {
          while (buf.length >= 9 && buf.length >= 9 + buf.readUInt32LE(5)) {
            const channel = buf.readUInt32LE(0)
            const kind = buf.readUInt8(4)
            const payload = buf.subarray(9, 9 + buf.readUInt32LE(5))
            buf = buf.subarray(9 + payload.length)
            if (channel) { core.onFrame(channel, kind, payload); continue }
            socket.write(frame(0, 0, Buffer.from(await answer(core, JSON.parse(payload.toString('utf8')), socket))))
          }
        }
        socket.on('data', (chunk) => { buf = Buffer.concat([buf, chunk]); void drain() })
        socket.on('close', () => core.dropSocket(socket))
        void drain()
        return
      }
      // Events session (no terminal): refused for good, the server polls terminal.list instead.
      if (call.method === 'events.subscribe') return socket.end(await answer(core, call) + '\n')
      socket.end(await answer(core, call) + '\n')
    })
  })
  return new Promise(resolve => server.listen(socketPath, () => resolve(server)))
}

// A random start: two runs side by side (or a v2 server on 7699) rarely probe the same port.
async function freePort() {
  const first = 7600 + Math.floor(Math.random() * 90)
  for (let i = 0; i < 90; i++) {
    const port = 7600 + ((first - 7600 + i) % 90)
    const probe = createServer()
    const ok = await new Promise<boolean>((resolve) => {
      probe.once('error', () => resolve(false))
      probe.listen(port, '127.0.0.1', () => resolve(true))
    })
    if (ok) {
      await new Promise<void>(resolve => probe.close(() => resolve()))
      return port
    }
  }
  throw new Error('No free isolated test port')
}

export const test = base.extend<{ core: FakeCore }>({
  core: async ({}, use) => {
    const dir = await mkdtemp(path.join(tmpdir(), 'wherdr-core-e2e-'))
    const home = path.join(dir, 'home')
    const data = path.join(dir, 'data')
    fs.mkdirSync(path.join(home, 'projects'), { recursive: true })
    fs.mkdirSync(data, { recursive: true })
    fs.writeFileSync(path.join(data, 'auth.json'), JSON.stringify(pdfAuthDb))
    fs.writeFileSync(path.join(data, 'push.json'), '{"subs":[]}')
    fs.writeFileSync(path.join(data, 'onboarding.json'), JSON.stringify({ done: true, host: 'devbox' }))
    const socketPath = path.join(dir, 'core.sock')
    const port = await freePort()
    const core = new FakeCore(home, `http://localhost:${port}`)
    const sock = await serveCore(core, socketPath)
    const app: ChildProcess = spawn(process.execPath, ['.output/server/index.mjs'], {
      stdio: process.env.CORE_E2E_LOG ? 'inherit' : 'ignore',
      env: {
        PATH: process.env.PATH, HOME: home, DATA_DIR: data, HOST: '127.0.0.1', PORT: String(port), TZ: 'UTC',
        HOST_LABEL: 'devbox', WHERDR_BACKEND: 'core', NUXT_PUBLIC_CORE: 'true', HC_SOCKET: socketPath,
        HERDR_WEB_MACHINES: 'off', WHERDR_UPDATE_CHECK: 'off', WHERDR_RUNTIME_DIR: path.join(dir, 'run'),
      },
    })
    try {
      await expect.poll(async () => {
        try { return (await fetch(`http://127.0.0.1:${port}/api/health`)).ok } catch { return false }
      }, { timeout: 20_000 }).toBe(true)
      await use(core)
    } finally {
      core.close()
      if (app.exitCode === null) {
        app.kill('SIGTERM')
        await new Promise<void>(resolve => app.once('exit', () => resolve()))
      }
      await new Promise<void>(resolve => sock.close(() => resolve()))
      await rm(dir, { recursive: true, force: true })
    }
  },
  baseURL: async ({ core }, use) => { await use(core.base) },
  context: async ({ context, core }, use) => {
    await context.addCookies([{ name: 'hw_session', value: pdfSession(), url: core.base }])
    await use(context)
  },
})
