// "Open in my terminal": a folder an agent wrote (`~/project/`) in the default
// terminal app of the computer wherdr runs on, an interactive shell in it. Only
// for an agent on this computer and a browser on it too (the route checks both).
//
// The folder travels in a script file of its own (mode 0700, in a private temp
// folder), which the terminal runs with `sh` and which becomes the user's shell.
// Linux: `xdg-terminal-exec` (Omarchy's default), else $TERMINAL. macOS: `open`
// on a `.command` file, which the default terminal app of the Mac runs.
import { execFile, spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import path from 'node:path'
import { HerdrError } from './herdr'
import { log } from './env'
import { findPane } from './state'
import { chatFilesPolicy } from './chatFiles'
import { chatFilesRoots } from '../../shared/chatFiles'
import { resolveAgentPath } from '../../shared/filePaths'
import { PANE_RE, splitId } from '../../shared/ids'

const sq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`

// The script the terminal runs: the folder, then the user's own login shell.
// With a command, the shell runs it first (`-lc`) and then stays, so the output stays readable.
export function terminalScript(dir: string, shell = '/bin/sh', command = ''): string {
  return `#!/bin/sh
rm -f -- "$0"; rmdir -- "$(dirname -- "$0")" 2>/dev/null
cd ${sq(dir)} || { printf 'No such folder: %s\\n' ${sq(dir)}; read -r _; exit 1; }
${command ? `${sq(shell)} -lc ${sq(command)}\n` : ''}exec ${sq(shell)} -l
`
}
type Env = Record<string, string | undefined>

// A terminal started by a service has no desktop session: find the display
// the way the session names it (Wayland socket under XDG_RUNTIME_DIR).
export function desktopEnv(env: Env, uid: number, list: (dir: string) => string[] = d => (existsSync(d) ? readdirSync(d) : [])): Env {
  const out = { ...env }
  out.XDG_RUNTIME_DIR ||= `/run/user/${uid}`
  if (!out.WAYLAND_DISPLAY) {
    const sock = list(out.XDG_RUNTIME_DIR).filter(f => /^wayland-\d+$/.test(f)).sort()[0]
    if (sock) out.WAYLAND_DISPLAY = sock
  }
  return out
}

// The programs that can open the terminal, in the order to try them.
export function terminalLaunchers(platform: string, env: Env, script: string): [string, string[]][] {
  if (platform === 'darwin') return [['open', [script]]]
  const own = (env.TERMINAL || '').trim().split(/\s+/)[0]
  return [
    ['xdg-terminal-exec', ['sh', script]],
    ...(own && own !== 'xdg-terminal-exec' ? [[own, ['-e', 'sh', script]] as [string, string[]]] : []),
  ]
}

// Starts the first launcher that exists; false when none does.
async function launch(cands: [string, string[]][], env: Env, platform: string): Promise<boolean> {
  for (const [bin, args] of cands) {
    const ok = await new Promise<boolean | 'missing'>((resolve) => {
      if (platform === 'darwin') {
        execFile(bin, args, { timeout: 15000 }, err => resolve(err ? (err as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : false : true))
        return
      }
      const child = spawn(bin, args, { env: env as NodeJS.ProcessEnv, detached: true, stdio: 'ignore' })
      child.once('error', e => resolve((e as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : false))
      child.once('spawn', () => { child.unref(); resolve(true) })
    })
    if (ok === 'missing') continue
    return ok
  }
  return false
}

export interface OpenTerminalDeps {
  findPane: (id: string) => { cwd: string | null } | undefined
  // The folder a written path means for this pane, when it is a folder.
  folder: (written: string, cwd: string | null) => Promise<string | null>
  // The script file to run: written, executable.
  write: (text: string) => string
  launch: (script: string) => Promise<boolean>
  // The folder in the desktop's file manager (xdg-open, `open` on macOS).
  openFolder: (dir: string) => Promise<boolean>
  shell: string
}
const defaultDeps: OpenTerminalDeps = {
  findPane,
  folder: async (written, cwd) => {
    const home = homedir()
    const abs = resolveAgentPath(written, cwd, home, chatFilesRoots(home, (await chatFilesPolicy()).level))
    return abs && (await stat(abs).catch(() => null))?.isDirectory() ? abs : null
  },
  write: (text) => {
    const file = path.join(mkdtempSync(path.join(tmpdir(), 'wherdr-term-')), process.platform === 'darwin' ? 'open.command' : 'open.sh')
    writeFileSync(file, text, { mode: 0o700 })
    return file
  },
  launch: script => launch(terminalLaunchers(process.platform, process.env, script), desktopEnv(process.env, process.getuid?.() ?? 0), process.platform),
  openFolder: dir => launch(process.platform === 'darwin' ? [['open', [dir]]] : [['xdg-open', [dir]]], desktopEnv(process.env, process.getuid?.() ?? 0), process.platform),
  shell: process.env.SHELL || '/bin/sh',
}

// The folder a request means, after the checks both actions share.
// `sameMachine`: the request comes from a browser on this computer.
// `own`: the pane's own folder (a command runs there), never a written path;
// outside the allowed folders it is refused, never replaced by the home folder.
async function requestedFolder(body: { pane_id?: unknown, path?: unknown }, sameMachine: boolean, deps: OpenTerminalDeps, own = false) {
  const paneId = String(body.pane_id || '')
  if (!PANE_RE.test(paneId)) throw new HerdrError('bad_pane', 'Invalid pane')
  if (splitId(paneId).machine !== '') throw new HerdrError('not_local', 'This works for an agent on this computer only')
  if (!sameMachine) throw new HerdrError('not_local', 'This works from a browser on the agent’s computer only')
  const pane = deps.findPane(paneId)
  if (!pane) throw new HerdrError('bad_pane', 'Pane not found')
  if (own) {
    const cwd = pane.cwd?.startsWith('/') ? pane.cwd : ''
    if (!cwd) throw new HerdrError('bad_path', 'The agent’s folder is not known')
    const dir = await deps.folder(cwd, cwd)
    if (!dir) throw new HerdrError('outside_roots', 'The agent’s folder is outside the folders chat files may use (Settings › Security › Files shown from conversations): the command was not run')
    return { paneId, dir }
  }
  const written = typeof body.path === 'string' ? body.path.trim() : ''
  if (!written || written.length > 1024 || /[\0\n\r]/.test(written)) throw new HerdrError('bad_path', 'Invalid folder')
  const dir = await deps.folder(written, pane.cwd)
  if (!dir) throw new HerdrError('not_found', 'This folder does not exist, or is outside the folders chat files may use')
  return { paneId, dir }
}

// With a command, it runs in the pane's own folder (the one its confirmation names).
export async function openTerminal(body: { pane_id?: unknown, path?: unknown, command?: unknown }, sameMachine: boolean, deps: OpenTerminalDeps = defaultDeps) {
  const command = typeof body.command === 'string' ? body.command.trim() : ''
  if (command.length > 4096 || /[\0\n\r]/.test(command)) throw new HerdrError('bad_command', 'Invalid command')
  const { paneId, dir } = await requestedFolder(body, sameMachine, deps, Boolean(command))
  const ok = await deps.launch(deps.write(terminalScript(dir, deps.shell, command)))
  log(`open-terminal: ${paneId}: ${ok ? 'opened' : 'no terminal'}`)
  if (!ok) throw new HerdrError('open_failed', 'No terminal app found: install one or set $TERMINAL')
  return { ok: true }
}

export async function openFileManager(body: { pane_id?: unknown, path?: unknown }, sameMachine: boolean, deps: OpenTerminalDeps = defaultDeps) {
  const { paneId, dir } = await requestedFolder(body, sameMachine, deps)
  const ok = await deps.openFolder(dir)
  log(`open-folder: ${paneId}: ${ok ? 'opened' : 'no file manager'}`)
  if (!ok) throw new HerdrError('open_failed', 'No file manager found')
  return { ok: true }
}
