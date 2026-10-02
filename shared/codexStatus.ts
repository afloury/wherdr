// Codex notices shown in its conversation view: "Update available" (with an
// Update button) and the weekly-limit warning. Pure logic, shared by the
// server and the tests. Structured data first:
//  - running version: `cli_version` in the header of the agent's rollout;
//  - latest version: `latest_version` in ~/.codex/version.json (Codex's own
//    daily check, `dismissed_version` when the user skipped it in Codex);
//  - installed version: ~/.codex/packages/standalone/current/codex-package.json
//    (standalone installer), or the result of an update run by wherdr;
//  - weekly limit: the last `rate_limits` of the agent's rollout.
// The screen only fills the gaps (versions of an older Codex, the update
// command it suggests, the warning line). A command read from the screen is
// never run as is: only the known official commands below can be run.
import { compareVersions, parseVersion } from './updates'

export const CODEX_RELEASE_NOTES = 'https://github.com/openai/codex/releases/latest'
// Official update commands printed by Codex ("Run … to update."), one per
// install method. The standalone one downloads the installer from this URL only.
export const CODEX_STANDALONE_COMMAND = `sh -c 'curl -fsSL https://chatgpt.com/codex/install.sh | CODEX_NON_INTERACTIVE=1 sh'`
const KNOWN_COMMANDS = [
  CODEX_STANDALONE_COMMAND,
  'npm install -g @openai/codex',
  'npm install -g @openai/codex@latest',
  'bun install -g @openai/codex',
  'bun install -g @openai/codex@latest',
  'brew upgrade --cask codex',
  'brew upgrade codex',
]
// Warning threshold of Codex itself ("less than 25% of your weekly limit left").
export const WEEKLY_WARN_LEFT = 25

const norm = (s: string) => s.trim().replace(/\s+/g, ' ')

// The known command `text` is (spacing aside), or null: anything else
// (other URL, extra arguments, chained command) is only shown to copy.
export function knownUpdateCommand(text: string | null | undefined): string | null {
  const t = norm(String(text || ''))
  return KNOWN_COMMANDS.find(c => c === t) ?? null
}

export interface CodexScreenInfo {
  // "✨ Update available! 0.159.1 -> 0.160.0"
  update?: { current: string, latest: string }
  // "Run <command> to update." (raw text, not validated)
  command?: string
  // "weekly limit: 12% left" in the footer, or "less than 25% of your weekly limit left".
  weeklyLeft?: number
}

const VERSION = String.raw`v?(\d+\.\d+\.\d+(?:-[\w.]+)?)`
const UPDATE_RE = new RegExp(String.raw`Update available!?\s*${VERSION}\s*(?:->|→)\s*${VERSION}`, 'i')
const WEEK_LEFT_RE = /weekly limit:?\s*(\d{1,3})\s*%\s*left/i
const WEEK_LESS_RE = /less than\s*(\d{1,3})\s*%\s*of your weekly limit left/i

// What Codex's screen says (plain text, as read by `pane.read`). The update
// command may wrap over several lines in a narrow pane.
export function parseCodexScreen(text: string | null | undefined): CodexScreenInfo {
  const out: CodexScreenInfo = {}
  if (!text) return out
  const lines = text.split('\n').map(l => l.replace(/^[\s│┃]+|[\s│┃]+$/g, ''))
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!
    const u = UPDATE_RE.exec(l)
    if (u) out.update = { current: u[1]!, latest: u[2]! }
    const r = /(?:^|\s)Run\s+(.*)$/.exec(l)
    if (r && (out.update || /to update\.?$/.test(l) || lines.slice(i + 1, i + 4).some(x => /to update\.?$/.test(x)))) {
      let cmd = r[1]!
      for (let j = i + 1; j < Math.min(lines.length, i + 4) && !/\bto update\.?$/.test(cmd); j++) cmd += ` ${lines[j]}`
      const m = /^(.*?)\s+to update\.?$/.exec(cmd)
      if (m) out.command = norm(m[1]!)
    }
    // The footer gauge is the current value: it wins over the heads-up message.
    const w = WEEK_LEFT_RE.exec(l)
    if (w) out.weeklyLeft = clampPct(Number(w[1]))
    else {
      const h = WEEK_LESS_RE.exec(l)
      if (h && out.weeklyLeft === undefined) out.weeklyLeft = clampPct(Number(h[1]))
    }
  }
  return out
}
const clampPct = (n: number) => Math.max(0, Math.min(100, n))

// ~/.codex/version.json: { latest_version, last_checked_at, dismissed_version }.
export function parseVersionFile(text: string | null | undefined): { latest: string | null, dismissed: string | null } {
  try {
    const d = JSON.parse(String(text || ''))
    const v = (x: unknown) => (typeof x === 'string' && parseVersion(x) ? x.replace(/^v/, '') : null)
    return { latest: v(d && d.latest_version), dismissed: v(d && d.dismissed_version) }
  } catch { return { latest: null, dismissed: null } }
}

// Version of a standalone install (codex-package.json of the `current` release).
export function parsePackageVersion(text: string | null | undefined): string | null {
  try {
    const v = JSON.parse(String(text || '')).version
    return typeof v === 'string' && parseVersion(v) ? v : null
  } catch { return null }
}

// `cli_version` of a rollout's first line (session_meta).
export function rolloutCliVersion(head: string | null | undefined): string | null {
  const first = String(head || '').split('\n', 1)[0] || ''
  if (!first.includes('"session_meta"')) return null
  const m = /"cli_version"\s*:\s*"([^"\\]{1,40})"/.exec(first)
  return m && parseVersion(m[1]!) ? m[1]! : null
}

// `codex --version` output ("codex-cli 0.160.0").
export function parseCliVersion(out: string | null | undefined): string | null {
  const m = /\b(\d+\.\d+\.\d+(?:-[\w.]+)?)\b/.exec(String(out || ''))
  return m ? m[1]! : null
}

export type CodexUpdateJob = { phase: 'running' } | { phase: 'done', version: string | null, at: number } | { phase: 'failed', error: string }

export interface CodexUpdate {
  // `available`: newer version to install; `installed`: already installed
  // on the machine, the agent must be restarted to use it.
  state: 'available' | 'installed'
  latest: string
  // Version the agent runs (null if unknown).
  current: string | null
  // Command to update: the known official one, or the screen's text to copy.
  command: string | null
  // The server may run `command` on the agent's machine (known command, writable home).
  runnable: boolean
  notes: string
  job?: CodexUpdateJob
}

export interface CodexWeekly { left: number, resetsAt: number | null, source: 'rollout' | 'screen' }
export interface CodexStatus { update?: CodexUpdate, weekly?: CodexWeekly }

const newest = (...vs: (string | null | undefined)[]) =>
  vs.reduce<string | null>((a, b) => (!b ? a : !a || compareVersions(b, a) > 0 ? b : a), null)

// Version the agent runs. What was seen (the rollout's header, the last
// "Update available! A -> B" on screen) may date from an earlier process of
// the pane: an agent started after an install runs at least that version.
export function runningVersion(o: {
  rollout: string | null
  screen: CodexScreenInfo
  bornAt?: number | null
  installed?: string | null
  installedAt?: number | null
  job?: CodexUpdateJob | null
}): string | null {
  let v = newest(o.rollout, o.screen.update?.current)
  if (o.bornAt && o.installed && o.installedAt && o.bornAt > o.installedAt) v = newest(v, o.installed)
  if (o.bornAt && o.job?.phase === 'done' && o.bornAt > o.job.at) v = newest(v, o.job.version)
  return v
}

// Update notice of a Codex agent, or null. `canRun`: the server can run a
// command on the agent's machine (remote over SSH, or a writable local home).
export function codexUpdateState(o: {
  running: string | null
  latest: string | null
  dismissed?: string | null
  installed: string | null
  standalone: boolean
  screen: CodexScreenInfo
  canRun: boolean
  job?: CodexUpdateJob | null
}): CodexUpdate | null {
  const running = o.running
  // A version installed by wherdr's update is also installed on the machine.
  const done = o.job?.phase === 'done' ? o.job.version : null
  const installed = newest(o.installed, done)
  const latest = newest(o.latest, o.screen.update?.latest)
  const have = newest(installed, running)
  const job = o.job || undefined
  const base = { notes: CODEX_RELEASE_NOTES, ...(job ? { job } : {}) }
  if (latest && have && compareVersions(latest, have) > 0 && o.dismissed !== latest) {
    // Standalone install (seen on disk): its command, whatever the screen says.
    const known = o.standalone ? CODEX_STANDALONE_COMMAND : knownUpdateCommand(o.screen.command)
    const command = known || (o.screen.command ? norm(o.screen.command) : null)
    return { state: 'available', latest, current: have, command, runnable: Boolean(known && o.canRun), ...base }
  }
  if (installed && running && compareVersions(installed, running) > 0) {
    return { state: 'installed', latest: installed, current: running, command: null, runnable: false, ...base }
  }
  // Update running or failed with nothing else to say: its progress or error stays shown.
  if (job && job.phase !== 'done') return { state: 'available', latest: latest || '', current: running, command: null, runnable: false, ...base }
  return null
}

// Weekly-limit warning (≤ 25 % left): the rollout's last reading first, the
// screen otherwise. A window already reset is ignored.
export function codexWeekly(o: { week: { used: number, resetsAt: number | null } | null, screenLeft?: number, now: number }): CodexWeekly | null {
  if (o.week && (!o.week.resetsAt || o.week.resetsAt > o.now)) {
    const left = Math.round(Math.max(0, 100 - o.week.used))
    return left <= WEEKLY_WARN_LEFT ? { left, resetsAt: o.week.resetsAt, source: 'rollout' } : null
  }
  if (o.screenLeft !== undefined && o.screenLeft <= WEEKLY_WARN_LEFT) return { left: o.screenLeft, resetsAt: null, source: 'screen' }
  return null
}

// Shell script of an update: the known command, then the new version.
// PATH completed for a non-interactive SSH shell (Homebrew, npm, ~/.local/bin).
export function updateScript(command: string): string {
  const known = knownUpdateCommand(command)
  if (!known) throw new Error('unknown update command')
  return [
    'PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"; export PATH',
    'set -e',
    known,
    'codex --version 2>/dev/null || true',
    '',
  ].join('\n')
}
