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

// herdr-projects' data folder: its launcher exports HERDR_PROJECTS_DATA_DIR.
export function projectsDataDir(env = process.env, home = os.homedir()) {
  return env.HERDR_PROJECTS_DATA_DIR || path.join(home, '.herdr-projects', 'data')
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

// The same for a shell on another machine (SSH): completes $PATH with the
// PATH herdr-projects recorded there and the usual folders that exist there.
// No dependency beyond POSIX sh and sed.
export const USER_PATH_SH = [
  'f="${HERDR_PROJECTS_DATA_DIR:-$HOME/.herdr-projects/data}/env.json"',
  'p=""; [ -r "$f" ] && p=$(sed -n \'s/.*"PATH"[[:space:]]*:[[:space:]]*"\\([^"]*\\)".*/\\1/p\' "$f" 2>/dev/null | head -n 1)',
  'old_ifs=$IFS; IFS=:',
  // The recorded PATH as it is; the usual folders when they exist.
  `for d in $p; do case "$d" in /*) ;; *) continue ;; esac; case ":$PATH:" in *":$d:"*) ;; *) PATH="\${PATH:+$PATH:}$d" ;; esac; done`,
  `for d in ${USER_BIN_DIRS.map(d => `"$HOME/${d}"`).join(' ')} ${SYSTEM_BIN_DIRS.join(' ')}; do`,
  '  [ -d "$d" ] || continue',
  '  case ":$PATH:" in *":$d:"*) ;; *) PATH="${PATH:+$PATH:}$d" ;; esac',
  'done',
  'IFS=$old_ifs; export PATH; ',
].join('\n')
