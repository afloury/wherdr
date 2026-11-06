#!/usr/bin/env node
// Installs wherdr v3 (herdr-core backend) next to a running wherdr v2, then
// imports what v3 can use (scripts/v2-import.mjs). Never stops, changes or
// writes anything of v2. Linux with systemd --user. Run through
// scripts/install-v3-beside-v2.sh; `--help` lists the options.
//
// Output for people and agents: one line per step ("STEP", "OK", "SKIP"),
// "ERROR <code>: <what>" and "NEXT: <what the user must do>". --json prints
// one summary object on stdout (the lines go to stderr).
// Exit codes: 0 done (or plan printed), 2 bad usage, 3 missing prerequisite,
// 4 conflict (port, folder, service, tailscale entry taken), 5 a step failed,
// 6 installed, but something is left for the user (see NEXT lines).
import fs from 'node:fs'
import os from 'node:os'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defaultRun, describeV2, detectV2, runImport } from './v2-import.mjs'

export const EXIT = { ok: 0, usage: 2, missing: 3, conflict: 4, failed: 5, todo: 6 }
const MANIFEST = 'install-manifest.json'
// The repository this script comes from (package.json's repository field).
const REPO = (() => {
  try { return JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).repository.url.replace(/^git\+/, '') }
  catch { return '' }
})()
const HELP = `Usage: install-v3-beside-v2.sh [--yes] [options]

Without --yes, prints the plan and changes nothing (--dry-run says so explicitly).
  --yes                 apply the plan
  --uninstall           remove what this installer created (with --yes; --keep-data keeps <dir>/data)
  --json                one JSON summary on stdout
  --dir <dir>           v3 folder (default ~/wherdr-v3: src/, data/, update.sh)
  --name <name>         service name (default wherdr-v3; the hc service is <name>-hc)
  --port <n>            v3's local port (default 7684)
  --https-port <n>      tailscale serve HTTPS port (default 8104); --no-tailscale to skip
  --hc-session <s>      herdr-core session (default: default); --hc-bin <path>
  --repo <url|path>     wherdr repository (default: package.json's repository); --branch <b> (v3)
  --skip-import         do not import from v2
  v2 (default: found here): --v2-dir <dir> --v2-unit <file> --herdr-projects <dir> --herdr-bin <path>`

export function parseArgs(argv, home = os.homedir()) {
  const o = { dir: path.join(home, 'wherdr-v3'), name: 'wherdr-v3', port: '7684', httpsPort: '8104', hcSession: 'default', repo: REPO, branch: 'v3' }
  const flags = { '--yes': 'yes', '--dry-run': 'dryRun', '--json': 'json', '--uninstall': 'uninstall', '--keep-data': 'keepData', '--no-tailscale': 'noTailscale', '--skip-import': 'skipImport', '--help': 'help', '-h': 'help' }
  const values = { '--dir': 'dir', '--name': 'name', '--port': 'port', '--https-port': 'httpsPort', '--hc-session': 'hcSession', '--hc-bin': 'hcBin', '--repo': 'repo', '--branch': 'branch', '--v2-dir': 'v2Dir', '--v2-unit': 'unit', '--herdr-projects': 'hpDir', '--herdr-bin': 'herdrBin' }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (flags[a]) o[flags[a]] = true
    else if (values[a] && argv[i + 1] !== undefined) o[values[a]] = argv[++i]
    else throw new Error(`unknown option: ${a}`)
  }
  if (o.dryRun) o.yes = false
  for (const k of ['port', 'httpsPort']) if (!/^\d+$/.test(o[k]) || +o[k] < 1 || +o[k] > 65535) throw new Error(`--${k === 'port' ? 'port' : 'https-port'} must be a port number`)
  if (!/^[\w.-]{1,40}$/.test(o.name)) throw new Error('--name: letters, digits, . _ -')
  if (!/^[\w.-]{1,32}$/.test(o.hcSession)) throw new Error('--hc-session: letters, digits, . _ -')
  o.dir = path.resolve(o.dir.replace(/^~(?=\/|$)/, home))
  return o
}

// systemd quoting: double quotes, \ and " escaped, % doubled.
const sq = s => `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/%/g, '%%')}"`
const UNSET = 'UnsetEnvironment=CLAUDE_CODE_CHILD_SESSION CLAUDECODE CLAUDE_CODE_ENTRYPOINT HC_SCOPE HC_TERMINAL_ID HC_TERMINAL_SOCKET'

// The hc session as a service: started from systemd, never from the shell
// (or agent) running this installer, so no CLAUDE_CODE_CHILD_SESSION leaks in.
export function hcUnit({ hc, session, pathEnv }) {
  return `# herdr-core session for wherdr v3 (install-v3-beside-v2). Remove with: install-v3-beside-v2.sh --uninstall --yes
[Unit]
Description=herdr-core session ${session} for wherdr v3

[Service]
Type=oneshot
RemainAfterExit=yes
Environment=${sq(`HC_SESSION=${session}`)}
Environment=${sq(`PATH=${pathEnv}`)}
${UNSET}
ExecStart=${sq(hc)} server start
ExecStop=${sq(hc)} server stop

[Install]
WantedBy=default.target
`
}

export function v3Unit({ node, dir, socket, port, hcService }) {
  return `# wherdr v3 beside v2 (install-v3-beside-v2). Remove with: install-v3-beside-v2.sh --uninstall --yes
[Unit]
Description=wherdr v3 (herdr-core), beside wherdr v2
After=network.target${hcService ? ` ${hcService}` : ''}
${hcService ? `Wants=${hcService}\n` : ''}
[Service]
Type=simple
WorkingDirectory=${dir}/src
${['NODE_ENV=production', `HC_SOCKET=${socket}`, 'HOST=127.0.0.1', `PORT=${port}`, `DATA_DIR=${dir}/data`].map(e => `Environment=${sq(e)}`).join('\n')}
${UNSET}
ExecStart=${sq(node)} .output/server/index.mjs
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
`
}

export function updateScript({ branch, name, port }) {
  return `#!/usr/bin/env bash
# Update wherdr v3 (installed beside v2): fetch ${branch}, rebuild, restart. Data in ./data is kept.
set -euo pipefail
cd "$(dirname "$0")/src"
git fetch -q origin ${branch}
git checkout -q -f --detach origin/${branch}
{ npm ci --no-audit --no-fund --loglevel=error && npm run build; } > ../build.log 2>&1 || { tail -20 ../build.log; echo "ERROR build-failed: see $(cd .. && pwd)/build.log"; exit 5; }
systemctl --user restart ${name}.service
for i in $(seq 1 60); do curl -fsS http://127.0.0.1:${port}/api/health >/dev/null 2>&1 && break; sleep 1; done
curl -fsS http://127.0.0.1:${port}/api/health >/dev/null || { echo "ERROR not-answering: ${name} does not answer; journalctl --user -u ${name}"; exit 5; }
echo "OK wherdr v3 at $(git rev-parse --short HEAD) answers on http://127.0.0.1:${port}"
`
}

const portFree = port => new Promise(resolve => {
  const s = net.createServer().once('error', () => resolve(false)).once('listening', () => s.close(() => resolve(true)))
  s.listen(Number(port), '127.0.0.1')
})
const socketAlive = file => new Promise(resolve => {
  if (!fs.existsSync(file)) return resolve(false)
  const c = net.connect(file).once('connect', () => { c.destroy(); resolve(true) }).once('error', () => resolve(false))
  setTimeout(() => { c.destroy(); resolve(false) }, 2000)
})
const sleep = ms => new Promise(r => setTimeout(r, ms))
async function health(url, tries = 1) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(3000) })
      const j = await r.json()
      if (j?.name === 'wherdr') return j
    } catch {}
    if (i < tries - 1) await sleep(1000)
  }
  return null
}

export class Stop extends Error { constructor(code, id, msg) { super(msg); this.code = code; this.id = id } }

export async function main(argv = process.argv.slice(2), io = {}) {
  const run = io.run || defaultRun
  const env = io.env || process.env
  const home = io.home || os.homedir()
  let o
  try { o = parseArgs(argv, home) } catch (e) { console.error(`ERROR usage: ${e.message}`); return EXIT.usage }
  if (o.help) { console.log(HELP); return EXIT.ok }
  const say = (...l) => (o.json ? console.error : console.log)(...l)
  const summary = { mode: o.uninstall ? 'uninstall' : 'install', applied: !!o.yes, dir: o.dir, steps: [], next: [] }
  const step = (kind, text) => { summary.steps.push(`${kind} ${text}`); say(`${kind} ${text}`) }
  const next = text => { summary.next.push(text); say(`NEXT: ${text}`) }
  const unitDir = path.join(env.XDG_CONFIG_HOME || path.join(home, '.config'), 'systemd', 'user')
  const manifestFile = path.join(o.dir, MANIFEST)
  const manifest = (() => { try { return JSON.parse(fs.readFileSync(manifestFile, 'utf8')) } catch { return null } })()
  const save = m => { fs.mkdirSync(o.dir, { recursive: true }); fs.writeFileSync(manifestFile, JSON.stringify(m, null, 2) + '\n') }
  const runtime = env.XDG_RUNTIME_DIR || `/run/user/${process.getuid()}`
  const hcState = s => path.join(env.XDG_STATE_HOME || path.join(home, '.local', 'state'), 'herdr-core', s)
  const sctl = (...a) => run('systemctl', ['--user', ...a])
  let code = EXIT.ok
  try {
    if (o.uninstall) await uninstall()
    else code = await install()
  } catch (e) {
    if (!(e instanceof Stop)) throw e
    say(`ERROR ${e.id}: ${e.message}`)
    summary.error = { id: e.id, message: e.message }
    code = e.code
  }
  if (o.json) console.log(JSON.stringify({ ...summary, exit: code }, null, 2))
  return code

  async function install() {
    let leftForUser = false
    // 1. What is there.
    const v2 = detectV2({ ...o, home, env, run })
    say(describeV2(v2))
    summary.v2 = { found: v2.found, unit: v2.unit, dir: v2.dir, dataDir: v2.dataDir, port: v2.port, https: v2.tailscale.v2Https, board: v2.board, machines: v2.machines.length }
    if (!v2.found && !o.skipImport) next('no v2 install found: give --v2-dir / --v2-unit, or --skip-import for a plain v3 install')

    // 2. Prerequisites.
    if (process.platform !== 'linux') throw new Stop(EXIT.missing, 'unsupported-os', 'this installer sets up systemd --user services (Linux); on macOS follow docs/installation.md')
    const major = Number(process.versions.node.split('.')[0])
    if (major < 22) throw new Stop(EXIT.missing, 'missing-node', `Node.js 22 or newer is required (this is ${process.version})`)
    for (const [bin, id] of [['git', 'missing-git'], ['npm', 'missing-npm']]) {
      if (!run('sh', ['-c', `command -v ${bin}`]).ok) throw new Stop(EXIT.missing, id, `${bin} is not installed`)
    }
    if (!sctl('show-environment').ok) throw new Stop(EXIT.missing, 'missing-systemd-user', 'systemctl --user does not answer (no user systemd session)')
    const hcFound = o.hcBin || run('sh', ['-c', 'command -v hc']).out
    const hcVer = hcFound ? run(hcFound, ['--version']) : { ok: false }
    if (!hcVer.ok) throw new Stop(EXIT.missing, 'missing-hc', `herdr-core (hc) not found for ${process.arch}: install the ${process.platform}-${process.arch} build from https://github.com/herdrdev/herdr-core/releases (0.1.16 or newer), put hc on your PATH, then run this again`)
    const hc = path.resolve(hcFound)
    step('OK', `prerequisites: node ${process.version}, git, npm, systemd --user, ${hcVer.out}`)

    // 3. Conflicts (a previous run of this installer is not one: re-runs are safe).
    const mine = manifest || {}
    const name = o.name, hcName = `${o.name}-hc`
    if (!manifest && fs.existsSync(o.dir) && fs.readdirSync(o.dir).length) throw new Stop(EXIT.conflict, 'dir-exists', `${o.dir} exists and was not made by this installer: choose another --dir`)
    for (const n of [name, hcName]) {
      if (fs.existsSync(path.join(unitDir, `${n}.service`)) && !(mine.units || []).includes(n)) throw new Stop(EXIT.conflict, 'service-exists', `${n}.service already exists and is not this installer's: choose another --name`)
    }
    if (v2.unit && path.basename(v2.unit) === `${name}.service`) throw new Stop(EXIT.conflict, 'service-exists', `${name} is v2's service: choose another --name`)
    if (o.port === v2.port) throw new Stop(EXIT.conflict, 'port-taken', `port ${o.port} is v2's: choose another --port`)
    const running = sctl('is-active', `${name}.service`).out === 'active'
    if (!(await portFree(o.port)) && !(manifest && running)) throw new Stop(EXIT.conflict, 'port-taken', `port ${o.port} is in use: choose another --port`)
    const ts = !o.noTailscale && run('sh', ['-c', 'command -v tailscale']).ok
    const target = `http://127.0.0.1:${o.port}`
    let serveDone = false
    if (ts) {
      const entry = v2.tailscale.entries.find(e => e.https === o.httpsPort)
      if (entry && !entry.proxy.endsWith(`:${o.port}`)) throw new Stop(EXIT.conflict, 'https-port-taken', `tailscale serve already uses https port ${o.httpsPort} (${entry.proxy || 'tcp'}): choose another --https-port`)
      serveDone = !!entry
    }
    const socket = path.join(runtime, 'herdr-core', `${o.hcSession}.sock`)
    const hcUp = await socketAlive(socket)
    const ownHc = (mine.units || []).includes(hcName) || !hcUp

    // 4. The plan.
    const plan = [
      ownHc ? `start herdr-core session "${o.hcSession}" as ${hcName}.service (${socket})` : `use the running herdr-core session "${o.hcSession}" (${socket})`,
      fs.existsSync(path.join(o.dir, 'src')) ? `keep ${o.dir}/src` : `clone ${o.repo} (${o.branch}) into ${o.dir}/src`,
      fs.existsSync(path.join(o.dir, 'src', '.output', 'server', 'index.mjs')) ? 'keep the existing build' : `npm ci && npm run build (log: ${o.dir}/build.log)`,
      o.skipImport || !v2.found ? 'no import' : `import from v2 into ${o.dir}/data (v2 is only read)`,
      `${running ? 'keep' : 'start'} ${name}.service on ${target} (DATA_DIR ${o.dir}/data)`,
      !ts ? 'no tailscale serve (tailscale not found or --no-tailscale)' : serveDone ? `keep tailscale serve https:${o.httpsPort}` : `tailscale serve --bg --https=${o.httpsPort} ${target} (added beside v2's entries)`,
      `write ${o.dir}/update.sh`,
    ]
    if (!o.skipImport && v2.found) {
      const r = runImport({ ...o, v2, run, dataDir: path.join(o.dir, 'data'), hcSession: o.hcSession, hcBin: hc, dryRun: true, hcReachable: hcUp })
      plan.splice(4, 0, `  projects: ${r.projects.added.map(p => `${p.key} (${p.path})`).join(', ') || 'none'}; open tasks: ${r.tasks.added.length}; settings: ${r.settings.carried.length}`,
        `  machines to add: ${r.machines.added.map(x => `${x.name} (${x.target})`).join(', ') || 'none'}${r.machines.missing.length ? `; not reachable: ${r.machines.missing.map(x => `${x.target} (${x.reason})`).join(', ')}` : ''}`)
    }
    summary.plan = plan
    for (const p of plan) say(`PLAN ${p}`)
    if (!o.yes) { say('Dry run: nothing changed. Run again with --yes to apply.'); return EXIT.ok }

    // 5. Apply. The manifest is saved after each step, so --uninstall always knows what to remove.
    const m = { v: 1, createdDir: mine.createdDir ?? !fs.existsSync(o.dir), name, port: o.port, units: mine.units || [], machines: mine.machines || [], hcSession: o.hcSession, ...mine }
    save(m)
    if (ownHc) {
      if (m.hcStateCreated === undefined) m.hcStateCreated = !fs.existsSync(hcState(o.hcSession))
      fs.mkdirSync(unitDir, { recursive: true })
      fs.writeFileSync(path.join(unitDir, `${hcName}.service`), hcUnit({ hc, session: o.hcSession, pathEnv: env.PATH || '/usr/bin:/bin' }))
      if (!m.units.includes(hcName)) m.units.push(hcName)
      save(m)
      sctl('daemon-reload')
      const r = sctl('enable', '--now', `${hcName}.service`)
      if (!r.ok) throw new Stop(EXIT.failed, 'hc-start-failed', `${hcName}.service did not start: ${r.err.split('\n').pop()} (journalctl --user -u ${hcName})`)
      for (let i = 0; i < 20 && !(await socketAlive(socket)); i++) await sleep(500)
      if (!(await socketAlive(socket))) throw new Stop(EXIT.failed, 'hc-not-answering', `herdr-core does not answer on ${socket} (journalctl --user -u ${hcName})`)
      step('OK', `${hcName}.service: herdr-core session ${o.hcSession}`)
    } else step('SKIP', `herdr-core session ${o.hcSession} already runs`)

    const src = path.join(o.dir, 'src')
    if (!fs.existsSync(src)) {
      const r = run('git', ['clone', '-q', '--branch', o.branch, o.repo, src], { timeout: 600000 })
      if (!r.ok) throw new Stop(EXIT.failed, 'clone-failed', `git clone failed: ${r.err.split('\n').pop()}`)
      m.createdSrc = true; save(m)
      step('OK', `cloned ${o.branch} into ${src}`)
    } else step('SKIP', `${src} exists`)
    if (!fs.existsSync(path.join(src, '.output', 'server', 'index.mjs'))) {
      const r = run('sh', ['-c', `cd ${JSON.stringify(src)} && { npm ci --no-audit --no-fund --loglevel=error && npm run build; } > ../build.log 2>&1`], { timeout: 3600000 })
      if (!r.ok) throw new Stop(EXIT.failed, 'build-failed', `the build failed: see ${o.dir}/build.log`)
      step('OK', 'built')
    } else step('SKIP', 'already built')

    if (!o.skipImport && v2.found) {
      const r = runImport({ ...o, v2, run, dataDir: path.join(o.dir, 'data'), hcSession: o.hcSession, hcBin: hc })
      for (const x of r.machines.added) if (!m.machines.includes(x.name)) m.machines.push(x.name)
      save(m)
      summary.import = { report: r.report, projects: r.projects.added.map(p => p.key), tasks: r.tasks.added.length, machines: r.machines.added.map(x => x.name), machinesMissing: r.machines.missing.map(x => `${x.target}: ${x.reason}`), settings: r.settings.carried }
      step('OK', `imported ${r.projects.added.length} projects, ${r.tasks.added.length} tasks, ${r.machines.added.length} machines, ${r.settings.carried.length} settings; report ${r.report}`)
      for (const x of r.machines.missing) next(`machine ${x.target}: ${x.reason}`)
      if (r.machines.missing.length) leftForUser = true
    }

    fs.mkdirSync(path.join(o.dir, 'data'), { recursive: true, mode: 0o700 })
    fs.writeFileSync(path.join(unitDir, `${name}.service`), v3Unit({ node: process.execPath, dir: o.dir, socket, port: o.port, hcService: ownHc ? `${hcName}.service` : null }))
    if (!m.units.includes(name)) m.units.push(name)
    save(m)
    sctl('daemon-reload')
    sctl('enable', `${name}.service`)
    sctl('restart', `${name}.service`)
    const h = await health(`${target}/api/health`, 60)
    if (!h) throw new Stop(EXIT.failed, 'not-answering', `${name}.service does not answer on ${target} (journalctl --user -u ${name})`)
    step('OK', `${name}.service answers on ${target} (${h.version})`)
    summary.local = target

    fs.writeFileSync(path.join(o.dir, 'update.sh'), updateScript({ branch: o.branch, name, port: o.port }), { mode: 0o755 })
    step('OK', `${o.dir}/update.sh`)

    let code = leftForUser ? EXIT.todo : EXIT.ok
    if (ts && !serveDone) {
      const r = run('tailscale', ['serve', '--bg', `--https=${o.httpsPort}`, target])
      if (r.ok) { m.tailscale = o.httpsPort; save(m); serveDone = true; step('OK', `tailscale serve https:${o.httpsPort} → ${target}`) }
      else {
        code = EXIT.todo
        next(/denied|permission|operator|root/i.test(r.err)
          ? `tailscale needs your permission: run "sudo tailscale set --operator=$USER" once (or "sudo tailscale serve --bg --https=${o.httpsPort} ${target}"), then run this installer again`
          : `tailscale serve failed (${r.err.split('\n').pop()}): run "tailscale serve --bg --https=${o.httpsPort} ${target}" by hand`)
      }
    }
    if (ts && serveDone) {
      const self = (() => { try { return JSON.parse(run('tailscale', ['status', '--json']).out).Self.DNSName.replace(/\.$/, '') } catch { return null } })()
      if (self) {
        summary.url = `https://${self}:${o.httpsPort}/`
        const ok = await health(`${summary.url}api/health`, 10)
        step(ok ? 'OK' : 'WARN', `${summary.url} ${ok ? 'answers' : 'does not answer yet (the first HTTPS certificate can take a minute)'}`)
      }
    }
    if (run('loginctl', ['show-user', os.userInfo().username, '--property=Linger', '--value']).out !== 'yes') next('to keep v3 running after you log out, run "loginctl enable-linger" once')
    next('open v3, add a passkey and turn notifications on, on each device (they do not move from v2)')
    if (summary.import?.report) next(`read ${summary.import.report}: what was imported and what to do by hand`)
    return code
  }

  async function uninstall() {
    if (!manifest) { step('SKIP', `nothing to remove: no ${manifestFile}`); return }
    const m = manifest
    const plan = [
      ...(m.tailscale ? [`tailscale serve --https=${m.tailscale} off`] : []),
      ...[...(m.units || [])].reverse().map(u => `stop, disable and remove ${u}.service`),
      ...((m.units || []).includes(`${m.name}-hc`) ? [] : (m.machines || []).map(x => `hc machine rm ${x} (session ${m.hcSession})`)),
      ...(m.hcStateCreated && (m.units || []).includes(`${m.name}-hc`) ? [`remove herdr-core's state of session ${m.hcSession} (${hcState(m.hcSession)})`] : []),
      o.keepData ? `remove what is in ${o.dir} except data/` : m.createdDir ? `remove ${o.dir}` : `empty ${o.dir} (it existed, empty, before)`,
    ]
    summary.plan = plan
    for (const p of plan) say(`PLAN ${p}`)
    if (!o.yes) { say('Dry run: nothing changed. Run again with --uninstall --yes to remove.'); return }
    if (m.tailscale) {
      const r = run('tailscale', ['serve', `--https=${m.tailscale}`, 'off'])
      if (r.ok) step('OK', `tailscale serve https:${m.tailscale} off`)
      else next(`run "tailscale serve --https=${m.tailscale} off" (${r.err.split('\n').pop()})`)
    }
    const ownHc = (m.units || []).includes(`${m.name}-hc`)
    if (!ownHc) for (const x of m.machines || []) run(o.hcBin || 'hc', ['machine', 'rm', x], { env: { ...env, HC_SESSION: m.hcSession } })
    for (const u of [...(m.units || [])].reverse()) {
      sctl('disable', '--now', `${u}.service`)
      fs.rmSync(path.join(unitDir, `${u}.service`), { force: true })
      step('OK', `removed ${u}.service`)
    }
    sctl('daemon-reload')
    if (ownHc && m.hcStateCreated) { fs.rmSync(hcState(m.hcSession), { recursive: true, force: true }); step('OK', `removed ${hcState(m.hcSession)}`) }
    for (const f of fs.readdirSync(o.dir)) if (!(o.keepData && f === 'data')) fs.rmSync(path.join(o.dir, f), { recursive: true, force: true })
    if (m.createdDir && !o.keepData) fs.rmdirSync(o.dir)
    step('OK', o.keepData ? `emptied ${o.dir} (kept data/)` : m.createdDir ? `removed ${o.dir}` : `emptied ${o.dir}`)
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().then(code => process.exit(code), e => { console.error(`ERROR unexpected: ${e.stack || e}`); process.exit(1) })
}
