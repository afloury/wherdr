import { execFile } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { agentDescendants, coreShell, createCoreTranscripts, machineOfAddress, processInfo } from '../server/utils/coreTranscripts'
import { CoreError } from '../server/utils/core'
import type { Pane } from '../shared/types'

const fx = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')
const pane = (id: string, address: string, agent: string | null, cwd: string, extra: Partial<Pane> = {}) =>
  ({ id, coreAddress: address, agent, cwd, machine: '', agentSession: null, status: 'idle', ...extra }) as Pane
const SESSION = '11111111-2222-4333-8444-555555555555'
const CODEX_ID = '00000000-0000-4000-8000-00000000c0de'

// A "core" whose terminal.get answers from a table, and whose machine.exec really runs the command here.
function fakeCore(details: Record<string, object>) {
  const calls: string[] = []
  const call = async (method: string, params: any): Promise<any> => {
    calls.push(`${method} ${params.terminal || params.on || ''}`.trim())
    if (method === 'terminal.get') {
      if (!details[params.terminal]) throw new CoreError('not_found', 'x')
      return details[params.terminal]
    }
    if (method === 'machine.exec') {
      return await new Promise(resolve => execFile(params.argv[0], params.argv.slice(1), { encoding: 'buffer', env: { ...process.env, HOME: process.env.FAKE_REMOTE_HOME } },
        (err, stdout, stderr) => resolve({ code: err ? (err as any).code ?? 1 : 0, stdout: stdout.toString('base64'), stderr: stderr.toString('base64'), timed_out: false, truncated: false })))
    }
    throw new CoreError('rpc', method)
  }
  return { call, calls }
}

function homeWithTranscripts(cwd: string, pid: number) {
  const home = mkdtempSync(path.join(tmpdir(), 'hw-core-home-'))
  mkdirSync(path.join(home, '.claude/sessions'), { recursive: true })
  writeFileSync(path.join(home, '.claude/sessions', `${pid}.json`), JSON.stringify({ pid, sessionId: SESSION, cwd }))
  const dir = path.join(home, '.claude/projects', cwd.replace(/[^A-Za-z0-9]/g, '-'))
  mkdirSync(dir, { recursive: true })
  writeFileSync(path.join(dir, `${SESSION}.jsonl`), fx('claude-session.jsonl'))
  const now = new Date()
  const day = path.join(home, '.codex/sessions', String(now.getFullYear()), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0'))
  mkdirSync(day, { recursive: true })
  const meta = JSON.parse(fx('codex-rollout.jsonl').split('\n')[0]!)
  meta.payload.cwd = cwd
  meta.payload.timestamp = new Date(Date.now() - 1000).toISOString()
  const rest = fx('codex-rollout.jsonl').split('\n').slice(1).join('\n')
  writeFileSync(path.join(day, `rollout-x-${CODEX_ID}.jsonl`), JSON.stringify(meta) + '\n' + rest)
  return home
}

describe('core terminal details as process information', () => {
  it('lists the foreground program first, then the terminal process', () => {
    expect(processInfo({ pid: 10, argv: ['bash'], foreground: { pid: 12, name: 'claude', argv: ['claude'] } }).process_info.foreground_processes.map(p => p.pid)).toEqual([12, 10])
    expect(processInfo({ pid: 10, argv: ['claude'], foreground: { pid: 10, name: 'claude', argv: ['claude'] } }).process_info.foreground_processes).toHaveLength(1)
    expect(processInfo({}).process_info.foreground_processes).toEqual([])
  })
  it('reads the machine of an address', () => {
    expect(machineOfAddress('t3')).toBe('')
    expect(machineOfAddress('mac/t3')).toBe('mac')
  })
})

describe('agents under a terminal', () => {
  it('finds an agent started by a shell, not other programs', () => {
    const ps = ' 10 1 -bash\n 11 10 /usr/bin/node /x/claude --resume\n 12 11 sleep 5\n 20 1 claude\n 30 10 vim a.txt\n'
    expect(agentDescendants(ps, 10).map(p => p.pid)).toEqual([11])
  })
})

describe('conversations of core terminals', () => {
  const cwd = '/work/proj'
  const home = homeWithTranscripts(cwd, 4242)
  const core = fakeCore({
    t1: { pid: 4242, argv: ['claude'], created_ms: Date.now(), foreground: { pid: 4242, name: 'claude', argv: ['claude'], cwd } },
    t2: { pid: 99, argv: ['codex'], created_ms: Date.now() - 2000, foreground: { pid: 99, name: 'codex', argv: ['codex'], cwd } },
  })
  const panes = [pane('p1', 't1', 'claude', cwd), pane('p2', 't2', 'codex', cwd), pane('p3', 't3', null, cwd)]
  const t = createCoreTranscripts({ call: core.call, pane: id => panes.find(p => p.id === id), localHome: home })

  it('finds a Claude conversation from the terminal process', async () => {
    const r = await t.chat({ id: 'p1', agent: 'claude', cwd }, {})
    expect(r.available).toBe(true)
    expect(r.file).toBe(`${SESSION}.jsonl`)
    expect(r.items!.length).toBeGreaterThan(5)
    expect(core.calls).toContain('terminal.get t1')
  })

  it('finds a Codex conversation born with the terminal', async () => {
    const r = await t.chat({ id: 'p2', agent: 'codex', cwd }, {})
    expect(r.available).toBe(true)
    expect(r.file).toContain(CODEX_ID)
  })

  it('has no conversation for a Claude whose process left no session', async () => {
    const lone = fakeCore({ t1: { pid: 7, argv: ['claude'], foreground: { pid: 7, name: 'claude', argv: ['claude'], cwd } } })
    const t2 = createCoreTranscripts({ call: lone.call, pane: id => panes.find(p => p.id === id), localHome: home })
    expect(await t2.chat({ id: 'p1', agent: 'claude', cwd }, {})).toEqual({ available: false, reason: 'not_found' })
  })

  it('searches a conversation', async () => {
    const r = await t.search({ id: 'p1', agent: 'claude', cwd }, 'pong', Date.now() + 5000)
    expect(r.hits.length).toBeGreaterThan(0)
  })

  it('reads a remote machine through machine.exec', async () => {
    process.env.FAKE_REMOTE_HOME = home
    const remote = fakeCore({ 'box/t1': { pid: 4242, argv: ['claude'], foreground: { pid: 4242, name: 'claude', argv: ['claude'], cwd } } })
    const rp = [pane('r1', 'box/t1', 'claude', cwd, { machine: '626f78' })]
    const tr = createCoreTranscripts({ call: remote.call, pane: id => rp.find(p => p.id === id), localHome: '/nowhere' })
    const r = await tr.chat({ id: 'r1', agent: 'claude', cwd }, {})
    expect(r.available).toBe(true)
    expect(r.items!.length).toBeGreaterThan(5)
    expect(remote.calls.some(c => c === 'machine.exec box')).toBe(true)
  })
})

describe('remote shell', () => {
  it('maps failures to the codes the file layer understands', async () => {
    const down = coreShell(async () => { throw new CoreError('unreachable', 'machine is down') }, 'box')
    expect((await down('true')).code).toBe(255)
    const slow = coreShell(async () => ({ code: null, stdout: '', timed_out: true }), 'box')
    expect((await slow('true')).code).toBe(124)
    const big = coreShell(async () => ({ code: 0, stdout: Buffer.from('abcdef').toString('base64'), truncated: true }), 'box')
    expect((await big('true', [], { maxBytes: 3 })).code).not.toBe(0)
  })
})
