// "Reveal in Finder" and "Open" for a path written by an agent: run on the
// agent's machine (local, or over its SSH connection), macOS only.
//
// Safeguards: only a pane the app knows; the path is resolved against the
// agent's folder and must stay under the machine's home, checked here then
// again on the machine after symlinks are resolved; it must exist; "Open"
// never launches an application or a script. The path only ever travels as a
// quoted positional argument ($2), never as shell text.
//
// wherdr in a Linux container on a Mac (Docker): `open` does not exist there
// and the container reports Linux, so a local pane's script is run on the Mac
// host through the SSH target of HERDR_WEB_HOST_OPEN_TARGET. The Mac side
// still validates everything: the same checks (REVEAL_CHECKS) run there,
// behind the forced command of a key that may only call them
// (scripts/wherdr-open.sh, installed by scripts/install-host-open.sh).
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { HerdrError } from './herdr'
import { HOST_OPEN_KEY, HOST_OPEN_TARGET, HOST_OPEN_USER, IN_DOCKER, log } from './env'
import { findPane } from './state'
import { type Machine, getMachine } from './machines'
import type { ExecResult } from './fsx'
import { PANE_RE, splitId } from '../../shared/ids'
import { resolveAgentPath, runnablePath } from '../../shared/filePaths'
import { fmt } from '../../shared/message'

export type RevealMode = 'reveal' | 'open'

// The checks, run on the machine that has `open`. scripts/reveal.sh is the
// original: tests pin this embed to the file.
export const REVEAL_CHECKS = `p=$2
[ -e "$p" ] || exit 3
if command -v realpath >/dev/null 2>&1; then
  r=$(realpath "$p" 2>/dev/null) || exit 3
  h=$(realpath "$HOME" 2>/dev/null) || exit 4
elif [ -d "$p" ]; then
  r=$(cd -P "$p" 2>/dev/null && pwd -P) || exit 3
  h=$(cd -P "$HOME" 2>/dev/null && pwd -P) || exit 4
else
  d=$(cd -P "$(dirname "$p")" 2>/dev/null && pwd -P) || exit 3
  r="$d/$(basename "$p")"
  [ -L "$r" ] && [ "$1" = open ] && exit 4
  h=$(cd -P "$HOME" 2>/dev/null && pwd -P) || exit 4
fi
case "$r/" in "$h"/*) ;; *) exit 4 ;; esac
[ "$(uname -s)" = Darwin ] || exit 5
if [ "$1" = open ]; then
  case "$r" in *.app|*.app/*|*.command|*.tool|*.terminal|*.pkg|*.mpkg|*.workflow|*.scpt|*.applescript|*.jar|*.webloc|*.inetloc|*.fileloc|*.dmg) exit 7 ;; esac
  if [ -f "$r" ] && [ -x "$r" ]; then exit 7; fi
  # A folder opens in the configured editor (WH_OPEN_EDITOR, or the first line
  # of ~/.local/share/wherdr/editor — an app name for open -a); plain open
  # would give the file manager. Files: the LaunchServices default app.
  ed=\${WH_OPEN_EDITOR:-}
  if [ -z "$ed" ] && [ -f "$HOME/.local/share/wherdr/editor" ]; then
    ed=$(head -n1 "$HOME/.local/share/wherdr/editor" | tr -d '[:space:]')
  fi
  if [ -d "$r" ] && [ -n "$ed" ]; then
    open -a "$ed" "$r" || exit 6
  else
    open "$r" || exit 6
  fi
else
  open -R "$r" || exit 6
fi
echo "$r"`

// Server-side callers (this module, remote machines) run the checks as a
// script with positional arguments.
export const REVEAL_SCRIPT = REVEAL_CHECKS

export const revealArgs = (mode: RevealMode, absPath: string) => [mode, absPath]

const isMac = (m: Machine) => m.os === 'Darwin'

// The Mac host route: a local pane on a machine wherdr sees as Linux (wherdr
// in Docker on macOS), with an SSH target configured. The container sends
// `open <mode> <base64 path>`; the forced command on the Mac decodes the path
// (base64: never shell syntax, spaces or quotes included) and runs the checks.
export const hostOpenReady = () => Boolean(IN_DOCKER && HOST_OPEN_TARGET && existsSync(HOST_OPEN_KEY))

function runHostOpen(mode: RevealMode, absPath: string): Promise<ExecResult> {
  const { promise, resolve } = Promise.withResolvers<ExecResult>()
  // The command travels as separate execFile arguments (never a shell line);
  // base64 keeps the path opaque to the login shell on the Mac. Known hosts:
  // the same pinned file as the macOS socket bridge, when it exists.
  const known = '/data/macos/known_hosts'
  const pin = existsSync(known) ? ['-o', `UserKnownHostsFile=${known}`, '-o', 'StrictHostKeyChecking=yes'] : ['-o', 'StrictHostKeyChecking=accept-new']
  const cmd = `open ${mode} ${Buffer.from(absPath, 'utf8').toString('base64')}`
  execFile('ssh', [
    '-i', HOST_OPEN_KEY,
    '-o', 'IdentitiesOnly=yes',
    '-o', 'BatchMode=yes',
    '-o', 'ConnectTimeout=5',
    ...pin,
    `${HOST_OPEN_USER || 'root'}@${HOST_OPEN_TARGET}`,
    cmd,
  ], { timeout: 15000, encoding: 'buffer', maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
    const raw = err ? (typeof err === 'object' && err !== null && 'code' in err ? err.code : undefined) : 0
    resolve({ code: typeof raw === 'number' ? raw : err ? 1 : 0, stdout: stdout as Buffer, stderr: String(stderr || '') })
  })
  return promise
}

function runLocal(script: string, args: string[]): Promise<ExecResult> {
  const { promise, resolve } = Promise.withResolvers<ExecResult>()
  execFile('/bin/sh', ['-c', script, 'sh', ...args], { timeout: 15000, encoding: 'buffer' }, (err, stdout, stderr) => {
    const raw = err ? (typeof err === 'object' && err !== null && 'code' in err ? err.code : undefined) : 0
    resolve({ code: typeof raw === 'number' ? raw : err ? 1 : 0, stdout: stdout as Buffer, stderr: String(stderr || '') })
  })
  return promise
}

// Error for an exit code of REVEAL_SCRIPT.
export function revealError(code: number | null, p: string, m: { label: string }, stderr = ''): HerdrError {
  switch (code) {
    case 3: return new HerdrError('not_found', fmt('Not found on {machine}: {path}', { machine: m.label, path: p }))
    case 4: return new HerdrError('outside_home', 'Only files in your home folder can be shown')
    case 5: return new HerdrError('not_mac', fmt('{machine} is not a Mac', { machine: m.label }))
    case 7: return new HerdrError('runnable', 'Apps and scripts are not opened from wherdr: use Reveal in Finder')
    default: return new HerdrError('open_failed', fmt('Could not open on {machine}: {reason}', { machine: m.label, reason: stderr.trim().split('\n').pop() || `code ${code}` }))
  }
}

export async function revealPath(body: { pane_id?: unknown, path?: unknown, mode?: unknown }) {
  const paneId = String(body.pane_id || '')
  const written = String(body.path || '')
  const mode = body.mode === 'open' ? 'open' : body.mode === 'reveal' ? 'reveal' : null
  if (!mode) throw new HerdrError('bad_mode', 'Invalid action')
  if (!PANE_RE.test(paneId)) throw new HerdrError('bad_pane', 'Invalid pane')
  const pane = findPane(paneId)
  if (!pane) throw new HerdrError('bad_pane', 'Pane not found')
  if (!written || written.length > 1024) throw new HerdrError('bad_path', 'Invalid path')
  const m = getMachine(splitId(paneId).machine)
  if (!m) throw new HerdrError('bad_machine', 'unknown machine')
  if (!m.local && (m.status !== 'online' || !m.home)) throw new HerdrError('unreachable', fmt('{machine} is unreachable', { machine: m.label }))
  // A local pane on a machine that reports Linux: wherdr in a container. The
  // Mac host route runs the same checks there; without it, refuse as before.
  const viaHost = Boolean(m.local && !isMac(m) && hostOpenReady())
  if (!isMac(m) && !viaHost) throw new HerdrError('not_mac', fmt('{machine} is not a Mac', { machine: m.label }))
  const abs = resolveAgentPath(written, pane.cwd, m.home)
  if (!abs) throw new HerdrError('outside_home', 'Only files in your home folder can be shown')
  if (mode === 'open' && runnablePath(abs)) throw revealError(7, abs, m)
  const args = revealArgs(mode, abs)
  const r = viaHost ? await runHostOpen(mode, abs) : m.local ? await runLocal(REVEAL_SCRIPT, args) : await m.exec!(REVEAL_SCRIPT, args, { timeoutMs: 15000 })
  log(`reveal: ${mode} on ${m.label} for ${paneId}${viaHost ? ' (host open)' : ''}: ${r.code === 0 ? 'ok' : `refused (code ${r.code})`}`)
  if (r.code !== 0) throw revealError(r.code, abs, m, r.stderr)
  return { ok: true, mode, path: r.stdout.toString('utf8').trim() || abs, machine: m.label }
}
