// Codex notices: detection from the screen and Codex's files (fictional
// values), validation of the update command, and the update job with a fake
// machine (the real installer never runs here).
import { describe, expect, it, vi } from 'vitest'
import {
  CODEX_STANDALONE_COMMAND, codexUpdateState, codexWeekly, knownUpdateCommand, parseCliVersion,
  parseCodexScreen, parsePackageVersion, parseVersionFile, rolloutCliVersion, runningVersion, updateScript,
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

describe('parseCodexScreen', () => {
  it('reads the update box, its command and the weekly gauge', () => {
    expect(parseCodexScreen(SCREEN)).toEqual({
      update: { current: '0.159.1', latest: '0.160.0' },
      command: CODEX_STANDALONE_COMMAND,
      weeklyLeft: 12,
    })
  })

  it('joins a command wrapped over several lines', () => {
    const s = `│ ✨ Update available! 1.2.3 -> 1.3.0 │
│ Run sh -c 'curl -fsSL https://chatgpt.com/codex/install.sh | │
│ CODEX_NON_INTERACTIVE=1 sh' to update. │`
    expect(parseCodexScreen(s).command).toBe(CODEX_STANDALONE_COMMAND)
  })

  it('uses the heads-up message when the gauge is not shown', () => {
    expect(parseCodexScreen('⚠ Heads up, you have less than 25% of your weekly limit left. Run /status for a breakdown.')).toEqual({ weeklyLeft: 25 })
  })

  it('does not take "Run /status" for an update command', () => {
    expect(parseCodexScreen('⚠ Heads up, you have less than 10% of your weekly limit left. Run /status for a breakdown.').command).toBeUndefined()
  })

  it('finds nothing on an ordinary screen', () => {
    expect(parseCodexScreen('› Ask Codex to do anything\n  gpt-5.5 medium · ~/demo')).toEqual({})
    expect(parseCodexScreen(null)).toEqual({})
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
  const screen = { update: { current: '0.159.1', latest: '0.160.0' } }
  it('takes the newest version seen', () => {
    expect(runningVersion({ rollout: '0.158.0', screen })).toBe('0.159.1')
  })
  it('assumes an agent started after an install runs it', () => {
    expect(runningVersion({ rollout: '0.159.1', screen, bornAt: 2000, installed: '0.160.0', installedAt: 1000 })).toBe('0.160.0')
    expect(runningVersion({ rollout: '0.159.1', screen, bornAt: 500, installed: '0.160.0', installedAt: 1000 })).toBe('0.159.1')
    expect(runningVersion({ rollout: '0.159.1', screen: {}, bornAt: 3000, job: { phase: 'done', version: '0.160.0', at: 2000 } })).toBe('0.160.0')
  })
})

describe('codexUpdateState', () => {
  const base = { running: '0.159.1', latest: '0.160.0', installed: '0.159.1', standalone: true, screen: {}, canRun: true }

  it('offers the standalone command when a newer version is out', () => {
    expect(codexUpdateState(base)).toMatchObject({ state: 'available', latest: '0.160.0', current: '0.159.1', command: CODEX_STANDALONE_COMMAND, runnable: true })
  })

  it('only offers to copy when the server cannot run it', () => {
    expect(codexUpdateState({ ...base, canRun: false })).toMatchObject({ runnable: false, command: CODEX_STANDALONE_COMMAND })
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

  it('says nothing when up to date or dismissed in Codex', () => {
    expect(codexUpdateState({ ...base, latest: '0.159.1' })).toBeNull()
    expect(codexUpdateState({ ...base, dismissed: '0.160.0' })).toBeNull()
    expect(codexUpdateState({ ...base, running: null, installed: null, latest: null })).toBeNull()
  })
})

describe('codexWeekly', () => {
  const now = 1_000_000
  it('warns at 25 % left or less, from the rollout first', () => {
    expect(codexWeekly({ week: { used: 88, resetsAt: now + 5000 }, screenLeft: 30, now })).toEqual({ left: 12, resetsAt: now + 5000, source: 'rollout' })
    expect(codexWeekly({ week: { used: 60, resetsAt: now + 5000 }, screenLeft: 12, now })).toBeNull()
  })
  it('falls back to the screen once the window has reset or without a reading', () => {
    expect(codexWeekly({ week: { used: 95, resetsAt: now - 1 }, now })).toBeNull()
    expect(codexWeekly({ week: null, screenLeft: 20, now })).toEqual({ left: 20, resetsAt: null, source: 'screen' })
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

function setup(o: { local?: boolean, writable?: boolean, exitCode?: number, hang?: boolean } = {}) {
  const ts = '2026-01-01T10:00:00Z'
  const files = {
    [`${HOME}/.codex/version.json`]: '{"latest_version":"0.160.0","dismissed_version":null}',
    [`${HOME}/.codex/packages/standalone/current/codex-package.json`]: '{"version":"0.159.1"}',
    [ROLLOUT]: [
      `{"timestamp":"${ts}","type":"session_meta","payload":{"id":"demo","cli_version":"0.159.1"}}`,
      `{"timestamp":"${ts}","type":"event_msg","payload":{"type":"token_count","rate_limits":{"primary":{"used_percent":10,"window_minutes":300,"resets_at":${Date.parse(ts) / 1000 + 3600}},"secondary":{"used_percent":90,"window_minutes":10080,"resets_at":${Date.parse(ts) / 1000 + 86400}}}}}`,
      '',
    ].join('\n'),
  }
  const exec = vi.fn(async (_script: string, _input: Buffer, _t: number) => o.hang ? new Promise<never>(() => {}) : ({ code: o.exitCode ?? 0, stdout: Buffer.from('installed\ncodex-cli 0.160.0\n'), stderr: o.exitCode ? 'curl: (6) Could not resolve host' : '' }))
  const runLocal = vi.fn(async () => ({ code: 0, stdout: Buffer.from('codex-cli 0.160.0\n'), stderr: '' }))
  const m: CodexMachine = { key: 'mac', label: 'Laptop', local: Boolean(o.local), home: HOME, fs: fakeFs(files), online: true, exec: o.local ? null : exec }
  let clock = Date.parse(ts)
  const svc = createCodexStatus({
    machineOf: () => m,
    readScreen: async () => SCREEN,
    rolloutOf: async () => ROLLOUT,
    runLocal,
    writable: async () => Boolean(o.writable),
    onChange: () => {},
    log: () => {},
    now: () => clock,
  })
  const pane = { id: 'w1:p1', agent: 'codex', status: 'idle', bornAt: 500 } as Pane
  return { svc, pane, exec, runLocal, tick: (ms: number) => { clock += ms } }
}

describe('Codex status service', () => {
  it('combines files, rollout and screen', async () => {
    const { svc, pane } = setup()
    const st = await svc.compute(pane)
    expect(st?.update).toMatchObject({ state: 'available', latest: '0.160.0', current: '0.159.1', runnable: true })
    expect(st?.weekly).toMatchObject({ left: 10, source: 'rollout' })
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

  it('refuses to run locally when the home is read-only (container)', async () => {
    const { svc, pane, runLocal } = setup({ local: true, writable: false })
    expect((await svc.compute(pane))?.update).toMatchObject({ runnable: false, command: CODEX_STANDALONE_COMMAND })
    await expect(svc.startUpdate(pane)).rejects.toThrow(/cannot be run/)
    expect(runLocal).not.toHaveBeenCalled()
  })

  it('refuses a second update while one runs', async () => {
    const { svc, pane } = setup({ hang: true })
    await svc.startUpdate(pane)
    await expect(svc.startUpdate(pane)).rejects.toThrow(/already in progress/)
  })
})
