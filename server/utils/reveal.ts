// "Reveal in Finder" and "Open" for a path written by an agent: run on the
// agent's machine (local, or over its SSH connection), macOS only.
//
// Safeguards: only a pane the app knows; the path is resolved against the
// agent's folder and must stay under the machine's home, checked here then
// again on the machine after symlinks are resolved; it must exist; "Open"
// never launches an application or a script. The path only ever travels as a
// quoted positional argument ($2), never as shell text.
import { execFile } from 'node:child_process'
import { HerdrError } from './herdr'
import { log } from './env'
import { findPane } from './state'
import { type Machine, getMachine } from './machines'
import type { ExecResult } from './fsx'
import { PANE_RE, splitId } from '../../shared/ids'
import { resolveAgentPath, runnablePath } from '../../shared/filePaths'
import { fmt } from '../../shared/message'

export type RevealMode = 'reveal' | 'open'

// $1: reveal | open, $2: absolute path. Exit codes: 3 missing, 4 outside home,
// 5 not macOS, 6 `open` failed, 7 runnable (Open refused).
export const REVEAL_SCRIPT = `p=$2
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
  open "$r" || exit 6
else
  open -R "$r" || exit 6
fi
echo "$r"`

export const revealArgs = (mode: RevealMode, absPath: string) => [mode, absPath]

const isMac = (m: Machine) => m.os === 'Darwin'

function runLocal(script: string, args: string[]): Promise<ExecResult> {
  return new Promise((resolve) => {
    execFile('/bin/sh', ['-c', script, 'sh', ...args], { timeout: 15000, encoding: 'buffer' }, (err, stdout, stderr) => {
      const raw = err ? (err as { code?: unknown }).code : 0
      resolve({ code: typeof raw === 'number' ? raw : err ? 1 : 0, stdout: stdout as Buffer, stderr: String(stderr || '') })
    })
  })
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
  if (!isMac(m)) throw new HerdrError('not_mac', fmt('{machine} is not a Mac', { machine: m.label }))
  const abs = resolveAgentPath(written, pane.cwd, m.home)
  if (!abs) throw new HerdrError('outside_home', 'Only files in your home folder can be shown')
  if (mode === 'open' && runnablePath(abs)) throw revealError(7, abs, m)
  const args = revealArgs(mode, abs)
  const r = m.local ? await runLocal(REVEAL_SCRIPT, args) : await m.exec!(REVEAL_SCRIPT, args, { timeoutMs: 15000 })
  log(`reveal: ${mode} on ${m.label} for ${paneId}: ${r.code === 0 ? 'ok' : `refused (code ${r.code})`}`)
  if (r.code !== 0) throw revealError(r.code, abs, m, r.stderr)
  return { ok: true, mode, path: r.stdout.toString('utf8').trim() || abs, machine: m.label }
}
