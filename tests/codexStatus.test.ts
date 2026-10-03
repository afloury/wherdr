// Codex notices: detection from the screen and Codex's files (fictional
// values), validation of the update command, and the update job with a fake
// machine (the real installer never runs here).
import { describe, expect, it, vi } from 'vitest'
import {
  CODEX_STANDALONE_COMMAND, codexUpdateState, codexWeekly, knownUpdateCommand, parseCliVersion,
  parseCodexScreen, parsePackageVersion, parseResetTime, parseVersionFile, rolloutCliVersion, runningVersion, updateScript,
} from '../shared/codexStatus'
import { type CodexMachine, createCodexStatus } from '../server/utils/codexStatus'
import type { MachineFs } from '../server/utils/fsx'
import type { Pane } from '../shared/types'

const SCREEN = `╭─────────────────────────────────────────────────────────────────────────────────────────────────────╮
│ ✨ Update available! 0.159.1 -> 0.160.0                                                             │
│ Run sh -c 'curl -fsSL https://chatgpt.com/codex/install.sh | CODEX_NON_INTERACTIVE=1 sh' to update. │
│                                                                                                     │
│ See full release notes:                                                                             │
│ https://github.com/openai/codex/releases/latest                                                     │
╰─────────────────────────────────────────────────────────────────────────────────────────────────────╯

› hello

• Hello!

⚠ Heads up, you have less than 25% of your weekly limit left. Run /status for a breakdown.

                                                                    ⚠ weekly limit: 12% left · /status
› Ask Codex to do anything

  gpt-5.5 medium · ~/tests                                                   ⚠ 1 warning · f2 to view
`

// Real situation (fictional values): the TUI runs 0.159.1 while the shared
// app-server daemon writes `cli_version` 0.160.0 into the rollout; the startup
// heads-up predates an early weekly reset that `/status` shows.
const STATUS_SCREEN = `╭──────────────────────────────────────────────────────────────────────╮
│ ✨ Update available! 0.159.1 -> 0.160.0                              │
│ Run sh -c 'curl -fsSL https://chatgpt.com/codex/install.sh | CODEX_NON_INTERACTIVE=1 sh' to │
│ update.                                                              │
╰──────────────────────────────────────────────────────────────────────╯
  >_ OpenAI Codex (v0.159.1)
     ~/demo
⚠ Heads up, you have less than 25% of your weekly limit left. Run /status for a breakdown.
› hello
• Hello!
/status
  >_ OpenAI Codex (v0.159.1)
  Server:              Local background server
  5h limit:            [████████████████████] 100% left (resets 15:33)
  Weekly limit:        [████████████████████] 100% left (resets 10:33 on 10 Oct)
› Ask Codex to do anything
`

describe('parseCodexScreen', () => {
  it('reads the update box, its command and the weekly gauge', () => {
    expect(parseCodexScreen(SCREEN)).toEqual({
      update: { current: '0.159.1', latest: '0.160.0' },
      command: CODEX_STANDALONE_COMMAND,
      weekly: { left: 12, exact: true },
    })
  })

  it('joins a command wrapped over several lines', () => {
    const s = `│ ✨ Update available! 1.2.3 -> 1.3.0 │
│ Run sh -c 'curl -fsSL https://chatgpt.com/codex/install.sh | │
│ CODEX_NON_INTERACTIVE=1 sh' to update. │`
    expect(parseCodexScreen(s).command).toBe(CODEX_STANDALONE_COMMAND)
  })

  it('uses the heads-up message when the gauge is not shown', () => {
    expect(parseCodexScreen('⚠ Heads up, you have less than 25% of your weekly limit left. Run /status for a breakdown.')).toEqual({ weekly: { left: 25, exact: false } })
  })

  it('does not take "Run /status" for an update command', () => {
    expect(parseCodexScreen('⚠ Heads up, you have less than 10% of your weekly limit left. Run /status for a breakdown.').command).toBeUndefined()
  })

  it('finds nothing on an ordinary screen', () => {
    expect(parseCodexScreen('› Ask Codex to do anything\n  gpt-5.5 medium · ~/demo')).toEqual({})
    expect(parseCodexScreen(null)).toEqual({})
  })

  it('reads the TUI version and the /status weekly line with its reset', () => {
    expect(parseCodexScreen(STATUS_SCREEN)).toEqual({
      version: '0.159.1',
      update: { current: '0.159.1', latest: '0.160.0' },
      command: CODEX_STANDALONE_COMMAND,
      weekly: { left: 100, exact: true, resets: '10:33 on 10 Oct' },
    })
  })

  it('keeps the last TUI header (the pane restarted Codex)', () => {
    expect(parseCodexScreen('>_ OpenAI Codex (v0.158.0)\n…\n>_ OpenAI Codex (v0.160.0)').version).toBe('0.160.0')
  })
})

describe('knownUpdateCommand', () => {
  it('accepts the official commands, spacing aside', () => {
    expect(knownUpdateCommand(`  sh -c 'curl  -fsSL https://chatgpt.com/codex/install.sh | CODEX_NON_INTERACTIVE=1 sh' `)).toBe(CODEX_STANDALONE_COMMAND)
    expect(knownUpdateCommand('npm install -g @openai/codex')).toBe('npm install -g @openai/codex')
    expect(knownUpdateCommand('brew upgrade --cask codex')).toBe('brew upgrade --cask codex')
  })

  it('refuses any other URL, argument or chained command', () => {
    expect(knownUpdateCommand(`sh -c 'curl -fsSL https://example.com/codex/install.sh | CODEX_NON_INTERACTIVE=1 sh'`)).toBeNull()
    expect(knownUpdateCommand(`${CODEX_STANDALONE_COMMAND}; rm -rf ~`)).toBeNull()
    expect(knownUpdateCommand('npm install -g @openai/codex evil-package')).toBeNull()
    expect(knownUpdateCommand('npm install -g @openai/codex && touch x')).toBeNull()
    expect(knownUpdateCommand('')).toBeNull()
  })

  it('builds a script only from a known command', () => {
    const s = updateScript(CODEX_STANDALONE_COMMAND)
    expect(s).toContain(CODEX_STANDALONE_COMMAND)
    expect(s).toContain('codex --version')
    expect(() => updateScript('curl https://example.com/x | sh')).toThrow()
  })
})

describe("Codex's files", () => {
  it('reads version.json', () => {
    expect(parseVersionFile('{"latest_version":"0.160.0","last_checked_at":"2026-01-01T00:00:00Z","dismissed_version":null}')).toEqual({ latest: '0.160.0', dismissed: null })
    expect(parseVersionFile('not json')).toEqual({ latest: null, dismissed: null })
  })

  it('reads a standalone package and a rollout header', () => {
    expect(parsePackageVersion('{"layoutVersion":1,"version":"0.159.1","target":"x"}')).toBe('0.159.1')
    expect(rolloutCliVersion('{"timestamp":"2026-01-01T00:00:00Z","type":"session_meta","payload":{"id":"abc","cli_version":"0.159.1"}}\n{"x":1}')).toBe('0.159.1')
    expect(rolloutCliVersion('{"type":"event_msg"}')).toBeNull()
    expect(parseCliVersion('codex-cli 0.160.0\n')).toBe('0.160.0')
  })
})

describe('runningVersion', () => {
  it('trusts the TUI header over the rollout (written by the shared daemon)', () => {
    expect(runningVersion({ rollout: '0.160.0', screen: { version: '0.159.1' } })).toBe('0.159.1')
    expect(runningVersion({ rollout: '0.160.0', screen: { update: { current: '0.159.1', latest: '0.160.0' } } })).toBe('0.159.1')
    expect(runningVersion({ rollout: '0.158.0', screen: {} })).toBe('0.158.0')
    expect(runningVersion({ rollout: null, screen: {} })).toBeNull()
  })
})

describe('codexUpdateState', () => {
  const base = { running: '0.159.1', latest: '0.160.0', installed: '0.159.1', standalone: true, screen: {}, canRun: true }

  it('offers the standalone command when a newer version is out', () => {
    expect(codexUpdateState(base)).toMatchObject({ state: 'available', latest: '0.160.0', current: '0.159.1', command: CODEX_STANDALONE_COMMAND, runnable: true })
  })

  it('types it into the agent terminal when the server cannot run it', () => {
    expect(codexUpdateState(base)).toMatchObject({ method: 'direct' })
    expect(codexUpdateState({ ...base, canRun: false })).toMatchObject({ runnable: true, method: 'terminal', command: CODEX_STANDALONE_COMMAND })
  })

  it('shows an unknown screen command to copy, never to run', () => {
    const u = codexUpdateState({ ...base, standalone: false, installed: null, screen: { command: 'curl https://example.com/i.sh | sh' } })
    expect(u).toMatchObject({ runnable: false, command: 'curl https://example.com/i.sh | sh' })
  })

  it('runs a known screen command (npm install)', () => {
    const u = codexUpdateState({ ...base, standalone: false, installed: null, screen: { command: 'npm install -g @openai/codex' } })
    expect(u).toMatchObject({ runnable: true, command: 'npm install -g @openai/codex' })
  })

  it('offers a restart once installed', () => {
    expect(codexUpdateState({ ...base, installed: '0.160.0' })).toMatchObject({ state: 'installed', latest: '0.160.0', current: '0.159.1' })
    expect(codexUpdateState({ ...base, job: { phase: 'done', version: '0.160.0', at: 1 } })).toMatchObject({ state: 'installed' })
  })

  it('offers the update to an agent started after the install of an older version', () => {
    // Regression: 0.159.1 installed and running, 0.160.0 out (version.json).
    const running = runningVersion({ rollout: '0.160.0', screen: parseCodexScreen(STATUS_SCREEN) })
    expect(codexUpdateState({ ...base, running })).toMatchObject({ state: 'available', latest: '0.160.0', current: '0.159.1' })
  })

  it('says nothing when up to date or dismissed in Codex', () => {
    expect(codexUpdateState({ ...base, latest: '0.159.1' })).toBeNull()
    expect(codexUpdateState({ ...base, dismissed: '0.160.0' })).toBeNull()
    expect(codexUpdateState({ ...base, running: null, installed: null, latest: null })).toBeNull()
  })
})

describe('parseResetTime', () => {
  const now = new Date(2026, 9, 3, 10, 37).getTime()
  it('reads the /status reset formats', () => {
    expect(parseResetTime('10:33 on 10 Oct', now)).toBe(new Date(2026, 9, 10, 10, 33).getTime())
    expect(parseResetTime('3:46 PM on Oct 4', now)).toBe(new Date(2026, 9, 4, 15, 46).getTime())
    expect(parseResetTime('15:33', now)).toBe(new Date(2026, 9, 3, 15, 33).getTime())
    expect(parseResetTime('09:00', now)).toBe(new Date(2026, 9, 4, 9, 0).getTime())
    expect(parseResetTime('10:00 on 2 Jan', new Date(2026, 11, 30).getTime())).toBe(new Date(2027, 0, 2, 10, 0).getTime())
    expect(parseResetTime('soon', now)).toBeNull()
  })
})

describe('codexWeekly', () => {
  const now = new Date(2026, 9, 3, 10, 37).getTime()
  const H = 3600000
  const old = { used: 88, resetsAt: now + 17 * H, at: now - 10 * H }
  it('warns at 25 % left or less, from the structured reading first', () => {
    expect(codexWeekly({ week: old, screen: { left: 30, exact: false }, now })).toEqual({ left: 12, resetsAt: old.resetsAt, source: 'rollout' })
    expect(codexWeekly({ week: { ...old, used: 60 }, screen: { left: 12, exact: true }, now })).toBeNull()
  })
  it('uses the screen only without structured reading', () => {
    expect(codexWeekly({ week: null, screen: { left: 20, exact: false }, now })).toEqual({ left: 20, resetsAt: null, source: 'screen' })
  })
  it('hides an expired reading, even with the startup heads-up still on screen', () => {
    expect(codexWeekly({ week: { ...old, resetsAt: now - 1 }, screen: { left: 25, exact: false }, now })).toBeNull()
  })
  it('regression: /status shows a later window (early reset): hidden', () => {
    const screen = parseCodexScreen(STATUS_SCREEN).weekly
    expect(codexWeekly({ week: old, screen, now })).toBeNull()
  })
  it('keeps the rollout over a /status from an earlier window', () => {
    const screen = { left: 90, exact: true, resets: '10:33 on 26 Sep' }
    expect(codexWeekly({ week: old, screen, now })).toMatchObject({ left: 12, source: 'rollout' })
  })
  it('same window: the higher usage wins', () => {
    const at = new Date(now + 17 * H)
    const resets = `${at.getHours()}:${String(at.getMinutes()).padStart(2, '0')} on ${at.getDate()} Oct`
    expect(codexWeekly({ week: { ...old, used: 70 }, screen: { left: 8, exact: true, resets }, now })).toMatchObject({ left: 8, source: 'rollout', resetsAt: old.resetsAt })
  })
  it('takes the freshest structured reading of the machine', () => {
    const fresh = { used: 0, resetsAt: now + 160 * H, at: now - H }
    expect(codexWeekly({ week: old, machine: fresh, now })).toBeNull()
    expect(codexWeekly({ week: { ...old, at: now }, machine: fresh, now })).toMatchObject({ left: 12 })
  })
})

// ---------------------------------------------------------------- service
const HOME = '/home/demo'
const ROLLOUT = `${HOME}/.codex/sessions/2026/01/01/rollout-demo.jsonl`
function fakeFs(files: Record<string, string>): MachineFs {
  const get = (p: string) => {
    if (!(p in files)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    return files[p]!
  }
  return {
    stat: async p => ({ size: Buffer.byteLength(get(p)), mtimeMs: 1000, isFile: true, isDir: false }),
    statMany: async ps => ps.map(p => (p in files ? { size: files[p]!.length, mtimeMs: 1000, isFile: true, isDir: false } : null)),
    readdir: async () => [],
    readFile: async p => get(p),
    read: async (p, start, len) => Buffer.from(get(p)).subarray(start, start + len),
  }
}

function setup(o: { local?: boolean, writable?: boolean, exitCode?: number, hang?: boolean, screen?: string | Error, cliVersion?: string } = {}) {
  const ts = '2026-01-01T10:00:00Z'
  const files = {
    [`${HOME}/.codex/version.json`]: '{"latest_version":"0.160.0","dismissed_version":null}',
    [`${HOME}/.codex/packages/standalone/current/codex-package.json`]: '{"version":"0.159.1"}',
    [ROLLOUT]: [
      `{"timestamp":"${ts}","type":"session_meta","payload":{"id":"demo","cli_version":"${o.cliVersion ?? '0.159.1'}"}}`,
      `{"timestamp":"${ts}","type":"event_msg","payload":{"type":"token_count","rate_limits":{"primary":{"used_percent":10,"window_minutes":300,"resets_at":${Date.parse(ts) / 1000 + 3600}},"secondary":{"used_percent":90,"window_minutes":10080,"resets_at":${Date.parse(ts) / 1000 + 86400}}}}}`,
      '',
    ].join('\n'),
  }
  const exec = vi.fn(async (_script: string, _input: Buffer, _t: number) => o.hang ? new Promise<never>(() => {}) : ({ code: o.exitCode ?? 0, stdout: Buffer.from('installed\ncodex-cli 0.160.0\n'), stderr: o.exitCode ? 'curl: (6) Could not resolve host' : '' }))
  const log = vi.fn()
  const runLocal = vi.fn(async () => ({ code: 0, stdout: Buffer.from('codex-cli 0.160.0\n'), stderr: '' }))
  const m: CodexMachine = { key: 'mac', label: 'Laptop', local: Boolean(o.local), home: HOME, fs: fakeFs(files), online: true, exec: o.local ? null : exec }
  let clock = Date.parse(ts)
  const svc = createCodexStatus({
    machineOf: () => m,
    readScreen: async () => {
      if (o.screen instanceof Error) throw o.screen
      return o.screen ?? SCREEN
    },
    rolloutOf: async () => ROLLOUT,
    runLocal,
    writable: async () => Boolean(o.writable),
    onChange: () => {},
    log,
    now: () => clock,
  })
  const pane = { id: 'w1:p1', agent: 'codex', status: 'idle', bornAt: 500 } as Pane
  return { svc, pane, exec, runLocal, log, tick: (ms: number) => { clock += ms } }
}

describe('Codex status service', () => {
  it('combines files, rollout and screen', async () => {
    const { svc, pane } = setup()
    const st = await svc.compute(pane)
    expect(st?.update).toMatchObject({ state: 'available', latest: '0.160.0', current: '0.159.1', runnable: true })
    expect(st?.weekly).toMatchObject({ left: 10, source: 'rollout' })
  })

  it('regression: banner for a 0.159.1 TUI behind a 0.160.0 daemon, no stale weekly alert', async () => {
    const { svc, pane, log } = setup({ screen: STATUS_SCREEN, cliVersion: '0.160.0' })
    const st = await svc.compute(pane)
    expect(st?.update).toMatchObject({ state: 'available', latest: '0.160.0', current: '0.159.1' })
    expect(st?.weekly).toBeUndefined()
    expect(log).toHaveBeenCalledOnce()
    expect(log.mock.calls[0]![0]).toMatch(/running=0\.159\.1 \(screen 0\.159\.1, rollout 0\.160\.0\).*-> available.*-> no warning/)
    await svc.compute(pane)
    expect(log).toHaveBeenCalledOnce() // only logged when the decision changes
  })

  it('logs why the screen could not be read', async () => {
    const { svc, pane, log } = setup({ screen: new Error('invalid request'), cliVersion: '0.160.0' })
    expect((await svc.compute(pane))?.update).toBeUndefined()
    expect(log.mock.calls[0]![0]).toMatch(/screen unreadable: invalid request, rollout 0\.160\.0/)
  })

  it('runs the known command over SSH, then offers the restart', async () => {
    const { svc, pane, exec } = setup()
    await svc.startUpdate(pane)
    await vi.waitFor(() => expect(exec).toHaveBeenCalledOnce())
    const [script, input] = exec.mock.calls[0]!
    expect(script).toBe('exec sh -s')
    expect(input.toString()).toContain(CODEX_STANDALONE_COMMAND)
    await vi.waitFor(async () => expect((await svc.compute(pane))?.update).toMatchObject({ state: 'installed', latest: '0.160.0' }))
  })

  it('reports a failure with its last error line', async () => {
    const { svc, pane } = setup({ exitCode: 1 })
    await svc.startUpdate(pane)
    await vi.waitFor(async () => expect((await svc.compute(pane))?.update?.job).toEqual({ phase: 'failed', error: 'curl: (6) Could not resolve host' }))
  })

  it('read-only home (container): never runs locally, types it into the agent pane', async () => {
    const { svc, pane, runLocal } = setup({ local: true, writable: false })
    expect((await svc.compute(pane))?.update).toMatchObject({ runnable: true, method: 'terminal', command: CODEX_STANDALONE_COMMAND })
    await expect(svc.startUpdate(pane)).rejects.toThrow(/cannot be run/)
    let finish!: () => void
    const inPane = vi.fn(async () => ({ done: new Promise<void>((r) => { finish = r }) }))
    expect(await svc.startUpdate(pane, inPane)).toEqual({ command: CODEX_STANDALONE_COMMAND, method: 'terminal' })
    expect(inPane).toHaveBeenCalledWith(CODEX_STANDALONE_COMMAND)
    expect(runLocal).not.toHaveBeenCalled()
    // Other Codex of the machine see it running; a second one is refused.
    await expect(svc.startUpdate(pane, inPane)).rejects.toThrow(/already in progress/)
    finish()
    await vi.waitFor(async () => expect(await svc.startUpdate(pane, inPane)).toMatchObject({ method: 'terminal' }))
  })

  it('a refusal from the pane (agent busy) starts nothing', async () => {
    const { svc, pane } = setup({ local: true, writable: false })
    const inPane = vi.fn(async () => { throw new Error('Codex is working or waiting for an answer') })
    await expect(svc.startUpdate(pane, inPane)).rejects.toThrow(/working/)
    await expect(svc.startUpdate(pane, inPane)).rejects.toThrow(/working/) // not "already in progress"
  })

  it('refuses a second update while one runs', async () => {
    const { svc, pane } = setup({ hang: true })
    await svc.startUpdate(pane)
    await expect(svc.startUpdate(pane)).rejects.toThrow(/already in progress/)
  })
})
