// `wherdr service install|uninstall`: start wherdr at login, with the absolute
// path of the runtime. macOS: a LaunchAgent; Linux: a systemd --user unit.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const LABEL = 'dev.wherdr'
export const UNIT = 'wherdr.service'

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

export function installService(spec, home = os.homedir()) {
  const file = serviceFile(home)
  if (!file) throw new Error(`no login service on ${process.platform}: keep wherdr running with your own service manager.`)
  mkdirSync(path.dirname(file), { recursive: true })
  mkdirSync(path.dirname(spec.log), { recursive: true })
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

export function uninstallService(home = os.homedir()) {
  const file = serviceFile(home)
  if (!file || !existsSync(file)) return null
  if (servicePlatform() === 'launchd') sh('launchctl', ['bootout', `${domain()}/${LABEL}`])
  else sh('systemctl', ['--user', 'disable', '--now', UNIT])
  rmSync(file)
  if (servicePlatform() === 'systemd') sh('systemctl', ['--user', 'daemon-reload'])
  return file
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
