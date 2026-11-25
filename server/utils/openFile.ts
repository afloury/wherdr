// A file in the default application of the computer wherdr runs on (xdg-open on Linux, `open`
// on macOS), as a double-click does. A service has no desktop session of its own: the Wayland
// socket is looked for under XDG_RUNTIME_DIR.
import { execFile, spawn } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'

type Env = Record<string, string | undefined>

export function desktopEnv(env: Env, uid: number, list: (dir: string) => string[] = d => (existsSync(d) ? readdirSync(d) : [])): Env {
  const out = { ...env }
  out.XDG_RUNTIME_DIR ||= `/run/user/${uid}`
  if (!out.WAYLAND_DISPLAY) {
    const sock = list(out.XDG_RUNTIME_DIR).filter(f => /^wayland-\d+$/.test(f)).sort()[0]
    if (sock) out.WAYLAND_DISPLAY = sock
  }
  return out
}

// Whether the opener started; false when there is none or it failed.
export function openWithDefaultApp(file: string): Promise<boolean> {
  if (process.platform === 'darwin') {
    return new Promise(resolve => execFile('open', [file], { timeout: 15000 }, err => resolve(!err)))
  }
  return new Promise((resolve) => {
    const env = desktopEnv(process.env, process.getuid?.() ?? 0) as NodeJS.ProcessEnv
    const child = spawn('xdg-open', [file], { env, detached: true, stdio: 'ignore' })
    child.once('error', () => resolve(false))
    child.once('spawn', () => { child.unref(); resolve(true) })
  })
}
