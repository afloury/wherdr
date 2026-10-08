// Homebrew install (the project's tap): the formula's `brew services` entry runs
// `wherdr run` at login (launchd label sh.brew.wherdr, homebrew.mxcl.wherdr before
// Homebrew 5; systemd unit of the same name on Linux), with its log in
// <prefix>/var/log/wherdr.log. The wherdr commands describe and point to it
// instead of their own pid file and login service.
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { BIN, homebrewInstall } from './core.mjs'

export const BREW_LABELS = ['sh.brew.wherdr', 'homebrew.mxcl.wherdr']

// <prefix>/Cellar/wherdr/<version>/libexec/… → the prefix, its brew and the service log.
export function brewPaths(bin = BIN) {
  if (!homebrewInstall(bin)) return null
  const prefix = bin.slice(0, bin.search(/[\\/]Cellar[\\/]wherdr[\\/]/))
  return { prefix, brew: path.join(prefix, 'bin', 'brew'), log: path.join(prefix, 'var', 'log', 'wherdr.log') }
}

// Output of `brew services info wherdr --json` → { loaded, running }; null if unreadable.
export function parseServiceInfo(text) {
  try {
    const info = [].concat(JSON.parse(text)).find(s => s?.name === 'wherdr')
    return info ? { loaded: !!info.loaded, running: !!info.running } : null
  } catch { return null }
}

// `launchctl print gui/<uid>/<label>` → running when it reports "state = running".
export function parseLaunchctl(text) {
  return /^\s*state = running\s*$/m.test(text)
}

const run = (cmd, args, env) => spawnSync(cmd, args, { encoding: 'utf8', timeout: 20_000, env: { ...process.env, ...env } })

// Without a usable brew: the LaunchAgent written by `brew services start`, and launchd's state.
function launchdState(home) {
  for (const label of BREW_LABELS) {
    if (!existsSync(path.join(home, 'Library', 'LaunchAgents', `${label}.plist`))) continue
    const r = run('launchctl', ['print', `gui/${process.getuid?.() ?? ''}/${label}`])
    return { loaded: r.status === 0, running: r.status === 0 && parseLaunchctl(r.stdout) }
  }
  return { loaded: false, running: false }
}

// null when this wherdr does not come from Homebrew; otherwise { prefix, brew, log, loaded, running }.
export function brewService(bin = BIN, home = os.homedir()) {
  const paths = brewPaths(bin)
  if (!paths) return null
  const r = run(paths.brew, ['services', 'info', 'wherdr', '--json'], { HOMEBREW_NO_AUTO_UPDATE: '1', HOMEBREW_NO_ENV_HINTS: '1' })
  const state = (r.status === 0 && parseServiceInfo(r.stdout))
    || (process.platform === 'darwin' ? launchdState(home) : { loaded: false, running: false })
  return { ...paths, ...state }
}

// ------------------------------------------------- what the commands say

// `wherdr start|stop|restart|service install` on a Homebrew install: the message
// pointing to brew services, or null to go on (start while the service runs).
export function brewRedirect(command, brew) {
  if (!brew) return null
  if (command === 'start') return brew.running ? null : 'this wherdr was installed with Homebrew: start it (now and at every login) with `brew services start wherdr`.'
  if (command === 'stop') return brew.running ? 'wherdr runs as a Homebrew service (launchd / systemd restart it): stop it with `brew services stop wherdr`.' : null
  if (command === 'restart') return 'this wherdr was installed with Homebrew: restart it with `brew services restart wherdr`.'
  if (command === 'service') return 'this wherdr was installed with Homebrew: start it at login with `brew services start wherdr` (stop: `brew services stop wherdr`).'
  return null
}

// Rows of `wherdr status` for a Homebrew install.
export function brewStatusRows(brew) {
  return {
    process: brew.running ? 'Homebrew service (brew services)' : null,
    service: brew.running ? 'Homebrew (brew services) · running'
      : brew.loaded ? 'Homebrew (brew services) · started but not running: wherdr logs'
        : 'Homebrew (brew services) · not started: brew services start wherdr',
    log: brew.log,
    hint: '\n  Start it: brew services start wherdr (now and at every login), then wherdr open.',
  }
}

// `wherdr doctor` line for a Homebrew install: [level, text], level ok | warn | fail.
export function brewDoctor(brew) {
  if (brew.running) return ['ok', `Login service: Homebrew (brew services), running · log ${brew.log}`]
  if (brew.loaded) return ['fail', `Login service: Homebrew (brew services), started but not running. See wherdr logs (${brew.log}).`]
  return ['warn', 'Login service: Homebrew (brew services), not started · brew services start wherdr runs wherdr now and at every login.']
}
