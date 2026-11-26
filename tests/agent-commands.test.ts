import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createAgentCommands, parseClaudeCommands, parseOmpCommands } from '../server/utils/agentCommands'
import { CoreError } from '../server/utils/core'
import { HerdrError } from '../server/utils/herdr'
import type { Pane } from '../shared/types'

const jsonl = (...rows: unknown[]) => rows.map(r => JSON.stringify(r)).join('\n') + '\n'

// omp --mode rpc 19: startup frames, then the answer to get_available_commands.
const OMP_COMMANDS = [
  { name: 'compact', description: 'Compact the conversation', input: { hint: '[focus]' }, source: 'builtin' },
  { name: 'model', aliases: ['models', 'model'], description: '  Show   the current\nmodel selection ', source: 'builtin' },
  { name: 'skill:release-notes', description: 'Draft release notes from merged pull requests.', input: { hint: 'arguments' }, source: 'skill' },
  { name: 'deploy', description: 'Ship the current branch', input: { hint: 'arguments' }, source: 'custom' },
  { name: 'acme:lint_report', description: 'Summarize lint findings', source: 'mcp_prompt' },
  { name: 'init', description: 'Generate AGENTS.md', source: 'file' },
  { name: 'two words', description: 'not a command name', source: 'custom' },
  { name: '/etc/passwd', source: 'custom' },
  { name: 'compact', description: 'a duplicate', source: 'builtin' },
]
const ompOutput = jsonl(
  { type: 'ready' },
  { type: 'extension_ui_request', method: 'setStatus', statusKey: 'x' },
  { type: 'available_commands_update', commands: [] },
  { id: 'cmds', type: 'response', command: 'get_available_commands', success: true, data: { commands: OMP_COMMANDS } },
)

// Claude Code 2.1: hook lines, then the answer to the initialize control request.
const CLAUDE_COMMANDS = [
  { name: 'compact', description: 'Free up context by summarizing the conversation so far', argumentHint: '<optional custom summarization instructions>', builtin: true },
  { name: 'release-notes', description: 'Draft release notes from merged pull requests. (user)', argumentHint: '' },
  { name: 'acme:review-api', description: '(acme) **Review** an `API` change before it ships', argumentHint: '[pr]', aliases: ['review-api', 'acme:review-api'] },
  { name: 'wrap-up', description: 'Close the session (project)', argumentHint: '' },
  { name: 'sync-docs', description: 'Pull the shared docs (claude.ai sync)', argumentHint: '' },
  { name: 'fast', description: 'Toggle fast mode (Opus 5.5)', argumentHint: '', builtin: true },
  { name: '__remote-workflow', description: 'Run the workflow script of this environment', builtin: true },
  { name: 'agents', description: '(removed) Manage subagents', builtin: true },
  { name: 'workflow-launch-exec', description: 'Run it (workflow_launch event sessions only)', builtin: true },
]
const claudeOutput = jsonl(
  { type: 'system', subtype: 'hook_started', hook_name: 'SessionStart:startup' },
  { type: 'control_response', response: { subtype: 'success', request_id: 'cmds', response: { commands: CLAUDE_COMMANDS, agents: [] } } },
  { type: 'system', subtype: 'hook_response', outcome: 'cancelled' },
)

// The hand-kept built-ins (agentBuiltins.ts) that follow the stand-in's own list: /compact is in it.
const OMP_SCREEN_ONLY = ['clear', 'new', 'resume', 'restart', 'settings', 'help', 'hotkeys', 'exit']
const CLAUDE_SCREEN_ONLY = ['clear', 'resume', 'help', 'permissions', 'config', 'rewind', 'status', 'exit']

describe('omp command listing', () => {
  it('reads the answer to get_available_commands', () => {
    expect(parseOmpCommands(ompOutput)).toEqual([
      { name: 'compact', kind: 'command', desc: 'Compact the conversation', hint: '[focus]', aliases: undefined },
      { name: 'model', kind: 'command', desc: 'Show the current model selection', hint: undefined, aliases: ['models'] },
      { name: 'skill:release-notes', kind: 'skill', desc: 'Draft release notes from merged pull requests.', hint: undefined, aliases: undefined },
      { name: 'deploy', kind: 'command', desc: 'Ship the current branch', hint: undefined, aliases: undefined },
      { name: 'acme:lint_report', kind: 'prompt', desc: 'Summarize lint findings', hint: undefined, aliases: undefined },
      { name: 'init', kind: 'command', desc: 'Generate AGENTS.md', hint: undefined, aliases: undefined },
    ])
  })

  it('has nothing without an answer to this request, or when omp refused it', () => {
    expect(parseOmpCommands('')).toBeNull()
    expect(parseOmpCommands('not json\n{"type":"ready"}\n')).toBeNull()
    expect(parseOmpCommands(jsonl({ id: 'other', type: 'response', success: true, data: { commands: [] } }))).toBeNull()
    expect(parseOmpCommands(jsonl({ id: 'cmds', type: 'response', success: false, error: 'Unknown command' }))).toBeNull()
    expect(parseOmpCommands(jsonl({ id: 'cmds', type: 'response', success: true, data: {} }))).toBeNull()
  })

  it('keeps long descriptions to a line', () => {
    const [c] = parseOmpCommands(jsonl({ id: 'cmds', type: 'response', success: true, data: { commands: [{ name: 'long', description: 'word '.repeat(200), source: 'custom' }] } }))!
    expect(c!.desc!.length).toBeLessThanOrEqual(240)
    expect(c!.desc!.endsWith('…')).toBe(true)
  })
})

describe('Claude Code command listing', () => {
  it('reads the answer to the initialize control request', () => {
    expect(parseClaudeCommands(claudeOutput)).toEqual([
      { name: 'compact', kind: 'command', desc: 'Free up context by summarizing the conversation so far', hint: '<optional custom summarization instructions>', aliases: undefined },
      { name: 'release-notes', kind: 'skill', desc: 'Draft release notes from merged pull requests.', hint: undefined, aliases: undefined },
      { name: 'acme:review-api', kind: 'skill', desc: 'Review an API change before it ships', hint: '[pr]', aliases: ['review-api'] },
      { name: 'wrap-up', kind: 'skill', desc: 'Close the session', hint: undefined, aliases: undefined },
      { name: 'sync-docs', kind: 'skill', desc: 'Pull the shared docs', hint: undefined, aliases: undefined },
      { name: 'fast', kind: 'command', desc: 'Toggle fast mode (Opus 5.5)', hint: undefined, aliases: undefined },
    ])
  })

  it('has nothing without an answer to this request, or when Claude refused it', () => {
    expect(parseClaudeCommands('')).toBeNull()
    expect(parseClaudeCommands(jsonl({ type: 'system', subtype: 'init' }))).toBeNull()
    expect(parseClaudeCommands(jsonl({ type: 'control_response', response: { subtype: 'success', request_id: 'other', response: { commands: [] } } }))).toBeNull()
    expect(parseClaudeCommands(jsonl({ type: 'control_response', response: { subtype: 'error', request_id: 'cmds', error: 'nope' } }))).toBeNull()
  })
})

interface ExecParams { argv: string[], on?: string, input?: string, timeout: number }
interface ExecReply { code: number, stdout: string, stderr: string }

// A "core" whose machine.exec really runs the command here, its input on the command's standard
// input, in a home folder of its own that holds the stand-in agents a test installs.
function fakeCore() {
  const home = mkdtempSync(path.join(tmpdir(), 'hw-cmds-home-'))
  const bin = path.join(home, '.local/bin')
  mkdirSync(bin, { recursive: true })
  const calls: { method: string, params: ExecParams }[] = []
  // What the stand-in saw: its folder, arguments, standard input and herdr/Claude environment.
  const ran = (agent: string) => {
    const read = (ext: string) => readFileSync(path.join(home, `${agent}.${ext}`), 'utf8')
    return { folder: read('folder').trim(), args: read('args').trim(), input: read('input'), env: read('env').trim().split('\n').filter(Boolean) }
  }
  const install = (agent: string, output: string) => {
    writeFileSync(path.join(home, `${agent}.out`), output)
    writeFileSync(path.join(bin, agent), `#!/bin/sh
pwd > "$HOME/${agent}.folder"
echo "$*" > "$HOME/${agent}.args"
env | grep -E '^(HERDR|HC)_|^CLAUDECODE=|^DISABLE_AUTOUPDATER=' | sort > "$HOME/${agent}.env"
cat > "$HOME/${agent}.input"
cat "$HOME/${agent}.out"
`, { mode: 0o755 })
  }
  // The terminal's identity is in the environment of the core that runs the command.
  const env = { PATH: '/usr/bin:/bin', HOME: home, HERDR_PANE_ID: 'p1', HERDR_ENV: '1', HC_TERMINAL_ID: 't1', CLAUDECODE: '1' }
  const call = async <T>(method: string, params: object): Promise<T> => {
    const p = params as ExecParams
    calls.push({ method, params: p })
    if (method !== 'machine.exec') throw new CoreError('rpc', method)
    if (p.on === 'offline') throw new CoreError('unreachable', 'x')
    const { promise, resolve } = Promise.withResolvers<ExecReply>()
    const child = spawn(p.argv[0]!, p.argv.slice(1), { env })
    const out: Buffer[] = []
    const err: Buffer[] = []
    child.stdout.on('data', (b: Buffer) => out.push(b))
    child.stderr.on('data', (b: Buffer) => err.push(b))
    child.on('close', code => resolve({ code: code ?? 1, stdout: Buffer.concat(out).toString('base64'), stderr: Buffer.concat(err).toString('base64') }))
    child.stdin.end(Buffer.from(p.input || '', 'base64'))
    return await promise as T
  }
  return { home, call, calls, install, ran, execs: () => calls.filter(c => c.method === 'machine.exec') }
}

const pane = (id: string, address: string, agent: string | null, cwd: string | null) =>
  ({ id, coreAddress: address, agent, cwd, machine: '', agentSession: null, status: 'idle' }) as Pane
const folder = () => realpathSync(mkdtempSync(path.join(tmpdir(), 'hw-cmds-project-')))

function setup(panes: Pane[]) {
  const core = fakeCore()
  const clock = { at: 1_000_000 }
  const commands = createAgentCommands({ call: core.call, pane: id => panes.find(p => p.id === id), now: () => clock.at })
  return { core, clock, commands }
}

describe('what a terminal’s agent offers after "/"', () => {
  it('asks omp on this machine, in the terminal’s folder', async () => {
    const project = folder()
    const { core, commands } = setup([pane('w1:p1', 't1', 'omp', project)])
    core.install('omp', ompOutput)
    const list = await commands.list('w1:p1')
    expect(list.agent).toBe('omp')
    expect(list.error).toBeUndefined()
    expect(list.commands.map(c => c.name)).toEqual(['compact', 'model', 'skill:release-notes', 'deploy', 'acme:lint_report', 'init', ...OMP_SCREEN_ONLY])
    // One run, here (no machine named), asked the way omp's RPC takes it.
    expect(core.execs()).toHaveLength(1)
    expect(core.execs()[0]!.params.on).toBeUndefined()
    expect(core.execs()[0]!.params.argv.slice(-1)).toEqual([project])
    const ran = core.ran('omp')
    expect(ran.folder).toBe(project)
    expect(ran.args).toBe('--mode rpc --no-session --no-extensions')
    expect(JSON.parse(ran.input)).toEqual({ id: 'cmds', type: 'get_available_commands' })
    // No self-update, and the terminal's identity never reaches it.
    expect(ran.env).toEqual(['DISABLE_AUTOUPDATER=1'])
  })

  it('asks Claude Code on the terminal’s own machine, without hooks, servers or the terminal’s identity', async () => {
    const project = folder()
    const { core, commands } = setup([pane('host-a~w1:p3', 'host-a/t3', 'claude', project)])
    core.install('claude', claudeOutput)
    const list = await commands.list('host-a~w1:p3')
    expect(list.agent).toBe('claude')
    expect(list.commands.map(c => c.name)).toEqual(['compact', 'release-notes', 'acme:review-api', 'wrap-up', 'sync-docs', 'fast', ...CLAUDE_SCREEN_ONLY])
    expect(core.execs()[0]!.params.on).toBe('host-a')
    const ran = core.ran('claude')
    expect(ran.folder).toBe(project)
    expect(ran.args).toBe('-p --input-format stream-json --output-format stream-json --verbose --no-session-persistence --settings {"disableAllHooks":true} --strict-mcp-config')
    expect(JSON.parse(ran.input)).toEqual({ type: 'control_request', request_id: 'cmds', request: { subtype: 'initialize' } })
    // The identity of the terminal (herdr's hooks would report this run as its session) never reaches it.
    expect(ran.env).toEqual(['DISABLE_AUTOUPDATER=1'])
  })

  it('starts in the home folder when the terminal’s folder is gone or unknown', async () => {
    const { core, commands } = setup([pane('w1:p1', 't1', 'omp', '/nonexistent/folder'), pane('w1:p2', 't2', 'omp', null)])
    core.install('omp', ompOutput)
    expect((await commands.list('w1:p1')).commands).not.toHaveLength(0)
    expect(core.ran('omp').folder).toBe(realpathSync(core.home))
    expect((await commands.list('w1:p2')).commands).not.toHaveLength(0)
    expect(core.ran('omp').folder).toBe(realpathSync(core.home))
  })

  it('asks once for the same machine, agent and folder within a minute, then again', async () => {
    const { core, clock, commands } = setup([pane('w1:p1', 't1', 'omp', '/srv/app'), pane('w1:p2', 't2', 'omp', '/srv/app'), pane('w1:p3', 't3', 'omp', '/srv/other')])
    core.install('omp', ompOutput)
    const [a, b] = await Promise.all([commands.list('w1:p1'), commands.list('w1:p2')])
    expect(a).toBe(b)
    expect(core.execs()).toHaveLength(1)
    clock.at += 59_000
    await commands.list('w1:p1')
    expect(core.execs()).toHaveLength(1)
    // Another folder is another answer.
    await commands.list('w1:p3')
    expect(core.execs()).toHaveLength(2)
    clock.at += 2_000
    await commands.list('w1:p1')
    expect(core.execs()).toHaveLength(3)
  })

  it('keeps each machine’s answer apart', async () => {
    const { core, commands } = setup([pane('w1:p1', 't1', 'omp', '/srv/app'), pane('host-a~w1:p1', 'host-a/t1', 'omp', '/srv/app')])
    core.install('omp', ompOutput)
    await commands.list('w1:p1')
    await commands.list('host-a~w1:p1')
    expect(core.execs().map(c => c.params.on)).toEqual([undefined, 'host-a'])
  })

  it('says when the agent is not installed there, and asks again soon', async () => {
    const { core, clock, commands } = setup([pane('w1:p1', 't1', 'claude', '/tmp')])
    expect(await commands.list('w1:p1')).toEqual({ agent: 'claude', commands: [], error: 'not_installed' })
    await commands.list('w1:p1')
    expect(core.execs()).toHaveLength(1)
    clock.at += 11_000
    core.install('claude', claudeOutput)
    expect((await commands.list('w1:p1')).commands.length).toBeGreaterThan(0)
    expect(core.execs()).toHaveLength(2)
  })

  it('says when the machine does not answer, or the agent says nothing usable', async () => {
    const { core, commands } = setup([pane('off~w1:p1', 'offline/t1', 'omp', '/tmp'), pane('w1:p2', 't2', 'omp', '/tmp')])
    expect(await commands.list('off~w1:p1')).toEqual({ agent: 'omp', commands: [], error: 'unreachable' })
    core.install('omp', 'Segmentation fault\n')
    expect(await commands.list('w1:p2')).toEqual({ agent: 'omp', commands: [], error: 'unavailable' })
  })

  it('offers nothing for other agents, and refuses a terminal that is not there', async () => {
    const { core, commands } = setup([pane('w1:p1', 't1', 'codex', '/tmp'), pane('w1:p2', 't2', null, '/tmp')])
    expect(await commands.list('w1:p1')).toEqual({ agent: null, commands: [] })
    expect(await commands.list('w1:p2')).toEqual({ agent: null, commands: [] })
    expect(core.calls).toHaveLength(0)
    await expect(commands.list('w9:p9')).rejects.toBeInstanceOf(HerdrError)
    await expect(commands.list('w9:p9')).rejects.toMatchObject({ code: 'bad_pane' })
  })
})

describe('the screen-only built-ins after the agent’s own list', () => {
  it('adds them as commands, and the agent’s entry wins on a clash of name or alias', async () => {
    const own = jsonl({ id: 'cmds', type: 'response', command: 'get_available_commands', success: true, data: { commands: [
      { name: 'compact', description: 'The agent’s own words', input: { hint: '[focus]' }, source: 'builtin' },
      { name: 'reset', aliases: ['clear'], description: 'Its own /clear', source: 'builtin' },
    ] } })
    const { core, commands } = setup([pane('w1:p1', 't1', 'omp', '/tmp')])
    core.install('omp', own)
    const list = (await commands.list('w1:p1')).commands
    expect(list.slice(0, 2).map(c => c.name)).toEqual(['compact', 'reset'])
    expect(list.find(c => c.name === 'compact')!.desc).toBe('The agent’s own words')
    expect(list.map(c => c.name).filter(n => n === 'clear' || n === 'compact')).toEqual(['compact'])
    expect(list.slice(2).map(c => c.name)).toEqual(['new', 'resume', 'restart', 'settings', 'help', 'hotkeys', 'exit'])
    expect(list.slice(2).every(c => c.kind === 'command' && c.desc)).toBe(true)
  })

  it('adds none when the agent could not be asked', async () => {
    const { commands } = setup([pane('w1:p1', 't1', 'claude', '/tmp')])
    expect((await commands.list('w1:p1')).commands).toEqual([])
  })
})
