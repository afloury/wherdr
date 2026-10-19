// `wherdr service install|uninstall`: start wherdr at login, with the absolute
// path of the runtime. macOS: a LaunchAgent; Linux: a systemd --user unit.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// WHERDR_SERVICE_NAME: another name for a second wherdr (or a test) next to
// the usual one: LaunchAgent dev.<name>, unit <name>.service.
const NAME = /^[\w.-]+$/.test(process.env.WHERDR_SERVICE_NAME || '') ? process.env.WHERDR_SERVICE_NAME : 'wherdr'
export const LABEL = `dev.${NAME}`
export const UNIT = `${NAME}.service`

export function servicePlatform(platform = process.platform) {
  return platform === 'darwin' ? 'launchd' : platform === 'linux' ? 'systemd' : null
}

export function serviceFile(home = os.homedir(), platform = process.platform) {
  const kind = servicePlatform(platform)
  if (kind === 'launchd') return path.join(home, 'Library', 'LaunchAgents', `${LABEL}.plist`)
  if (kind === 'systemd') return path.join(process.env.XDG_CONFIG_HOME || path.join(home, '.config'), 'systemd', 'user', UNIT)
  return null
}

const xml = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// { runtime, args: [bin, 'run', …], env: { PATH, … }, log }
export function launchdPlist({ runtime, args, env, log }) {
  const vars = Object.entries(env).map(([k, v]) => `    <key>${xml(k)}</key><string>${xml(v)}</string>`).join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<!-- wherdr at login (wherdr service install). Remove with: wherdr service uninstall -->
<plist version="1.0"><dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key><array>
${[runtime, ...args].map(a => `    <string>${xml(a)}</string>`).join('\n')}
  </array>
  <key>EnvironmentVariables</key><dict>
${vars}
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>${xml(log)}</string>
  <key>StandardErrorPath</key><string>${xml(log)}</string>
</dict></plist>
`
}

// systemd quoting: double quotes, with \ and " escaped; % doubled.
const sq = s => `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/%/g, '%%')}"`

export function systemdUnit({ runtime, args, env, log }) {
  return `# wherdr at login (wherdr service install). Remove with: wherdr service uninstall
[Unit]
Description=wherdr: your Herdr agents from your phone and browser
After=network.target

[Service]
Type=simple
ExecStart=${[runtime, ...args].map(sq).join(' ')}
${Object.entries(env).map(([k, v]) => `Environment=${sq(`${k}=${v}`)}`).join('\n')}
Restart=on-failure
RestartSec=5
StandardOutput=append:${log}
StandardError=append:${log}

[Install]
WantedBy=default.target
`
}

function sh(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: 'utf8' })
  return { ok: r.status === 0, out: `${r.stdout || ''}${r.stderr || ''}`.trim(), missing: r.error?.code === 'ENOENT' }
}

const domain = () => `gui/${process.getuid()}`

// { installed, running } of the login service.
export function serviceState(home = os.homedir()) {
  const file = serviceFile(home)
  if (!file || !existsSync(file)) return { installed: false, running: false }
  if (servicePlatform() === 'launchd') {
    const r = sh('launchctl', ['print', `${domain()}/${LABEL}`])
    return { installed: true, running: r.ok && /state = running/.test(r.out) }
  }
  return { installed: true, running: sh('systemctl', ['--user', 'is-active', '--quiet', UNIT]).ok }
}

// A failure leaves things as they were: the previous service file back (and
// loaded again), or no file at all, so a later run does not take a half-made
// service for an installed one. `run` is injectable for the tests.
export function installService(spec, home = os.homedir(), run = sh) {
  const file = serviceFile(home)
  if (!file) throw new Error(`no login service on ${process.platform}: keep wherdr running with your own service manager.`)
  mkdirSync(path.dirname(file), { recursive: true })
  mkdirSync(path.dirname(spec.log), { recursive: true })
  const before = existsSync(file) ? readFileSync(file, 'utf8') : null
  try {
    return writeService(file, spec, run)
  } catch (e) {
    restoreService(file, before, run)
    throw e
  }
}

function writeService(file, spec, sh) {
  if (servicePlatform() === 'launchd') {
    writeFileSync(file, launchdPlist(spec))
    sh('launchctl', ['bootout', `${domain()}/${LABEL}`])
    const r = sh('launchctl', ['bootstrap', domain(), file])
    if (!r.ok) throw new Error(`launchctl bootstrap failed: ${r.out}`)
  } else {
    writeFileSync(file, systemdUnit(spec))
    const reload = sh('systemctl', ['--user', 'daemon-reload'])
    if (reload.missing) throw new Error('systemctl is missing: this system has no systemd.')
    if (!reload.ok) throw new Error(`systemctl --user daemon-reload failed: ${reload.out}`)
    const r = sh('systemctl', ['--user', 'enable', '--now', UNIT])
    if (!r.ok) throw new Error(`systemctl --user enable --now failed: ${r.out}`)
  }
  return file
}

function restoreService(file, before, sh) {
  try {
    if (before === null) rmSync(file, { force: true })
    else writeFileSync(file, before)
    if (servicePlatform() === 'launchd') {
      if (before !== null) sh('launchctl', ['bootstrap', domain(), file])
    } else {
      sh('systemctl', ['--user', 'daemon-reload'])
    }
  } catch { /* best effort: the original error is the one to report */ }
}

export function uninstallService(home = os.homedir()) {
  const file = serviceFile(home)
  if (!file || !existsSync(file)) return null
  if (servicePlatform() === 'launchd') sh('launchctl', ['bootout', `${domain()}/${LABEL}`])
  else sh('systemctl', ['--user', 'disable', '--now', UNIT])
  rmSync(file)
  if (servicePlatform() === 'systemd') sh('systemctl', ['--user', 'daemon-reload'])
  return file
}

// systemd: is lingering on for this user (its services run without a login)?
export function lingerOn(user = os.userInfo().username, run = sh) {
  const r = run('loginctl', ['show-user', user, '--property=Linger', '--value'])
  return r.ok && r.out.trim() === 'yes'
}

// Turns lingering on for this user, without sudo (logind allows it for one's
// own user on most systems). { ok, already }: ok false when it was refused.
export function enableLinger(user = os.userInfo().username, run = sh) {
  if (lingerOn(user, run)) return { ok: true, already: true }
  const r = run('loginctl', ['enable-linger', user])
  return { ok: r.ok && lingerOn(user, run), already: false }
}

// start | stop | restart through the service manager.
export function controlService(action) {
  if (servicePlatform() === 'launchd') {
    const target = `${domain()}/${LABEL}`
    const r = action === 'stop' ? sh('launchctl', ['kill', 'SIGTERM', target])
      : sh('launchctl', ['kickstart', ...(action === 'restart' ? ['-k'] : []), target])
    if (!r.ok) throw new Error(`launchctl ${action} failed: ${r.out}`)
    return
  }
  const r = sh('systemctl', ['--user', action, UNIT])
  if (!r.ok) throw new Error(`systemctl --user ${action} failed: ${r.out}`)
}
