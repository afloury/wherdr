// The PATH of the user, for what wherdr runs without a login shell: the login
// service (systemd --user, launchd), the server it starts, and the
// herdr-projects commands of the Board, on this machine and over SSH.
//
// systemd and launchd start wherdr with a short system PATH, and an SSH command
// gets the remote shell's non-login PATH: agents installed in a user folder
// (~/.local/bin, ~/.bun/bin, ~/.cargo/bin, ~/.npm-global/bin, Homebrew) are
// then not found, and herdr-projects refuses with "claude is not installed
// here". herdr-projects only widens its own PATH when Herdr runs it as a plugin
// command; wherdr runs it directly. So wherdr completes the PATH itself, from:
//   1. the PATH it already has;
//   2. the PATH herdr-projects recorded from a login shell
//      ($HERDR_PROJECTS_DATA_DIR/env.json, default ~/.herdr-projects/data);
//   3. at `wherdr service install`: the PATH of the login shell, asked once;
//   4. the usual user and system bin folders, when they exist.
// Folders are only added, never removed or reordered: what the PATH already
// finds first stays first.
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// Where agent CLIs install themselves for one user (relative to $HOME).
export const USER_BIN_DIRS = ['.local/bin', '.bun/bin', '.cargo/bin', '.npm-global/bin', '.deno/bin', '.volta/bin', 'bin']
// Homebrew (Apple silicon, Intel, Linux) and the system.
export const SYSTEM_BIN_DIRS = ['/opt/homebrew/bin', '/opt/homebrew/sbin', '/home/linuxbrew/.linuxbrew/bin', '/usr/local/bin', '/usr/bin', '/bin', '/usr/local/sbin', '/usr/sbin', '/sbin']

// Joins PATH strings or folder lists into one PATH: absolute folders only,
// each once, in the order first seen.
export function mergePath(...parts) {
  const seen = new Set()
  for (const part of parts) {
    const list = Array.isArray(part) ? part : String(part || '').split(':')
    for (const raw of list) {
      const dir = String(raw || '').trim()
      if (dir && dir.startsWith('/') && !dir.includes('\n')) seen.add(dir.replace(/(.)\/+$/, '$1'))
    }
  }
  return [...seen].join(':')
}

const isDir = (p) => { try { return statSync(p).isDirectory() } catch { return false } }

// The usual folders that exist on this machine.
export function knownBinDirs(home = os.homedir(), exists = isDir) {
  return [...USER_BIN_DIRS.map(d => path.join(home, d)), ...SYSTEM_BIN_DIRS].filter(d => exists(d))
}

// herdr-projects' data folder, as it finds it: HERDR_PROJECTS_DATA_DIR, else
// HERDR_PROJECTS_HOME/data, else ~/.herdr-projects/data.
export function projectsDataDir(env = process.env, home = os.homedir()) {
  return env.HERDR_PROJECTS_DATA_DIR || path.join(env.HERDR_PROJECTS_HOME || path.join(home, '.herdr-projects'), 'data')
}

// The PATH herdr-projects recorded from a login shell, '' when there is none.
export function projectsEnvPath(env = process.env, home = os.homedir()) {
  const file = path.join(projectsDataDir(env, home), 'env.json')
  if (!existsSync(file)) return ''
  try {
    const p = JSON.parse(readFileSync(file, 'utf8'))?.PATH
    return typeof p === 'string' ? p : ''
  } catch { return '' }
}

// The PATH line of `env` output; what a shell prints before it is ignored.
export function pathFromEnvOutput(text) {
  const line = String(text || '').split('\n').find(l => l.startsWith('PATH='))
  return line ? line.slice(5).trim() : ''
}

// The login shell's PATH ($SHELL -lc env), '' when it cannot be had. Never
// interactive: no terminal, a few seconds at most.
export function loginShellPath(env = process.env, run = spawnSync) {
  const shell = env.SHELL && path.isAbsolute(env.SHELL) ? env.SHELL : '/bin/sh'
  try {
    const r = run(shell, ['-lc', 'env'], { encoding: 'utf8', timeout: 8000, stdio: ['ignore', 'pipe', 'ignore'], env })
    return r.status === 0 ? pathFromEnvOutput(r.stdout) : ''
  } catch { return '' }
}

// The PATH for the server and the commands it runs.
// `first`: folders to put before everything (the runtime's own folder).
// `login`: the login shell's PATH, when it was asked.
export function userPath({ env = process.env, home = os.homedir(), first = [], login = '', exists = isDir } = {}) {
  return mergePath(first, env.PATH || '', login, projectsEnvPath(env, home), knownBinDirs(home, exists))
}

// The value of the first "PATH" key of a JSON file (env.json), its escapes
// decoded as JSON.parse does (\" \\ \/ \b \f \n \r \t \uXXXX, surrogate
// pairs as UTF-8), then an `x` so that the shell keeps a trailing newline.
// Nothing when there is no such string, or when it is cut short, holds a NUL
// or a bad escape. POSIX awk (BusyBox, mawk, BSD, gawk), run with LC_ALL=C so
// that %c writes one byte. No single quote in it: the script quotes it so.
export const JSON_PATH_AWK = String.raw`{ s = s $0 "\n" } `
  + String.raw`function b(v) { return sprintf("%c", v) } `
  + String.raw`function hex(t,   j, x, v) { if (length(t) != 4) return -1; v = 0; for (j = 1; j <= 4; j++) { x = index("0123456789abcdef", tolower(substr(t, j, 1))); if (!x) return -1; v = v * 16 + x - 1 } return v } `
  + String.raw`END { if (!match(s, /"PATH"[ \t\r\n]*:[ \t\r\n]*"/)) exit; s = substr(s, RSTART + RLENGTH); n = length(s); o = ""; `
  + String.raw`for (k = 1; k <= n; k++) { c = substr(s, k, 1); `
  + String.raw`if (c == "\"") { printf "%sx", o; exit } `
  + String.raw`if (c != "\\") { o = o c; continue } `
  + String.raw`c = substr(s, ++k, 1); `
  + String.raw`if (c == "\"" || c == "\\" || c == "/") o = o c; else if (c == "b") o = o "\b"; else if (c == "f") o = o "\f"; else if (c == "n") o = o "\n"; else if (c == "r") o = o "\r"; else if (c == "t") o = o "\t"; `
  + String.raw`else if (c == "u") { v = hex(substr(s, k + 1, 4)); k += 4; `
  + String.raw`if (v >= 55296 && v < 56320) { if (substr(s, k + 1, 2) != "\\u") exit; w = hex(substr(s, k + 3, 4)); if (w < 56320 || w >= 57344) exit; k += 6; v = 65536 + (v - 55296) * 1024 + w - 56320 } `
  + String.raw`if (v <= 0 || (v >= 56320 && v < 57344)) exit; `
  + String.raw`if (v < 128) o = o b(v); else if (v < 2048) o = o b(192 + int(v / 64)) b(128 + v % 64); `
  + String.raw`else if (v < 65536) o = o b(224 + int(v / 4096)) b(128 + int(v / 64) % 64) b(128 + v % 64); `
  + String.raw`else o = o b(240 + int(v / 262144)) b(128 + int(v / 4096) % 64) b(128 + int(v / 64) % 64) b(128 + v % 64) } `
  + String.raw`else exit } }`

// The same for a shell on another machine (SSH): completes $PATH with the
// PATH herdr-projects recorded there and the usual folders that exist there,
// by the rules of userPath (added after, each once, absolute, no newline).
// Fixed text, POSIX sh and awk only; the recorded value is only split and
// assigned (no globbing), never run.
export const USER_PATH_SH = [
  'f="${HERDR_PROJECTS_DATA_DIR:-${HERDR_PROJECTS_HOME:-$HOME/.herdr-projects}/data}/env.json"',
  // awk where the system keeps it, even from a PATH without /usr/bin.
  `p=""; [ -r "$f" ] && p=$(PATH="\${PATH:+$PATH:}/usr/bin:/bin" LC_ALL=C awk '${JSON_PATH_AWK}' "$f" 2>/dev/null); p=\${p%x}`,
  "nl='\n'; ws=\" \t\r$nl\"; old_ifs=$IFS; IFS=:; set -f",
  // The recorded folders as mergePath takes them: trimmed, without a trailing
  // slash, absolute and on one line; the usual folders when they exist.
  'for d in $p; do',
  '  while :; do case "$d" in [$ws]*) d=${d#?} ;; *[$ws]) d=${d%?} ;; ?*/) d=${d%/} ;; *) break ;; esac; done',
  '  case "$d" in /*) ;; *) continue ;; esac; case "$d" in *"$nl"*) continue ;; esac',
  '  case ":$PATH:" in *":$d:"*) ;; *) PATH="${PATH:+$PATH:}$d" ;; esac',
  'done',
  `for d in ${USER_BIN_DIRS.map(d => `"$HOME/${d}"`).join(' ')} ${SYSTEM_BIN_DIRS.join(' ')}; do`,
  '  [ -d "$d" ] || continue',
  '  case ":$PATH:" in *":$d:"*) ;; *) PATH="${PATH:+$PATH:}$d" ;; esac',
  'done',
  'set +f; IFS=$old_ifs; export PATH; ',
].join('\n')
