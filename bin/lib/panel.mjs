// `wherdr panel`: one screen for everything (the Herdr plugin's "wherdr"
// action opens it in a popup). State, addresses, phone QR code, and one key
// per command; refreshed every few seconds.
//
// Commands run through a controller: `wherdr` itself, or the Herdr plugin
// script when WHERDR_CONTROL holds its argv as JSON (it knows Docker mode).
import { execFile, spawn } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { BIN, VERSION, c, probe } from './core.mjs'
import { context, livePid, tailnetName, tailscaleBin } from './commands.mjs'
import { serviceFile, serviceState } from './service.mjs'

const exec = promisify(execFile)

export const KEYS = [
  ['s', 'start'], ['x', 'stop'], ['r', 'restart'], ['o', 'open'], ['l', 'log'],
  ['u', 'update'], ['a', 'auto-start'], ['p', 'phone'], ['q', 'quit'],
]

// argv of the controller (`wherdr` or the plugin script) for a panel key.
export function keyCommand(key, state, control) {
  const base = control?.length ? control : [process.execPath, BIN]
  const own = !control?.length
  switch (key) {
    case 's': return [...base, 'start']
    case 'x': return [...base, 'stop']
    case 'r': return [...base, 'restart']
    case 'o': return [...base, 'open']
    case 'l': return [...base, 'logs', ...(own ? ['--follow'] : [])]
    case 'u': return own ? null : [...base, 'update']
    case 'a': return [...base, 'service', state.service.installed ? 'uninstall' : 'install']
    case 'p': return [...base, 'phone']
    default: return null
  }
}

// Phone address: https://<machine>.<tailnet>.ts.net:<port>/ once `tailscale
// serve` publishes the port; `served` says whether it does.
export function phoneAddress(name, port, serveJson) {
  if (!name) return null
  let served = false
  try { served = Boolean(JSON.parse(serveJson || '{}')?.TCP?.[String(port)]) } catch {}
  return { url: `https://${name}:${port}/`, served }
}

async function tailnet(port) {
  const ts = tailscaleBin()
  if (!ts) return { installed: false }
  const run = args => exec(ts, args, { encoding: 'utf8', timeout: 5000 }).then(r => r.stdout, () => '')
  const name = tailnetName(await run(['status', '--json']))
  return { installed: true, phone: phoneAddress(name, port, name ? await run(['serve', 'status', '--json']) : '') }
}

export async function gather(ctx, env = process.env, net = null) {
  const answer = await probe(ctx.port, ctx.host)
  return {
    version: VERSION,
    mode: env.WHERDR_MODE === 'docker' ? 'docker' : 'native',
    plugin: Boolean(env.WHERDR_CONTROL),
    runtime: process.versions.bun ? `bun ${process.versions.bun}` : `node ${process.versions.node}`,
    url: ctx.url,
    port: ctx.port,
    answer,
    pid: livePid(ctx.files.pid),
    service: env.WHERDR_MODE === 'docker' ? { installed: false, running: false } : serviceState(),
    serviceFile: serviceFile(),
    dir: ctx.dir,
    tailnet: net ?? await tailnet(ctx.port),
  }
}

const line = (label, value) => `  ${c.dim(label.padEnd(11))}${value}`

export function render(state, qrText = '') {
  const out = []
  out.push(`  ${c.bold('WHERDR')}  ${c.dim(state.version)}`)
  out.push(`  ${c.dim('─'.repeat(56))}`)
  const status = state.answer === 'wherdr' ? `${c.green('●')} running`
    : state.answer ? `${c.yellow('●')} port ${state.port} is taken by another program`
      : `${c.dim('○')} stopped`
  out.push(line('STATUS', status))
  out.push(line('LOCAL', c.cyan(state.url)))
  const phone = state.tailnet.phone
  if (phone?.served) out.push(line('TAILNET', c.cyan(phone.url)))
  else if (phone) out.push(line('TAILNET', `${c.dim(phone.url)} ${c.yellow('not published')} · P`))
  else out.push(line('TAILNET', c.dim(state.tailnet.installed ? 'Tailscale is not logged in · P' : 'no Tailscale on this machine · P')))
  out.push(line('MODE', state.mode === 'docker' ? 'Docker' : `native · ${state.runtime}`))
  out.push(line('AUTOSTART', autostart(state)))
  if (phone?.served && qrText) {
    out.push('')
    out.push(`  ${c.dim('SCAN WITH THE IPHONE CAMERA, THEN SHARE → ADD TO HOME SCREEN')}`)
    for (const l of qrText.split('\n')) out.push(`  ${l}`)
  } else if (!phone?.served) {
    out.push('')
    out.push(`  ${c.dim('Phone: press P for the tailnet setup; the QR code shows up here.')}`)
  }
  out.push('')
  out.push(`  ${KEYS.map(([k, label]) => `${c.bold(k.toUpperCase())} ${c.dim(label)}`).join('  ')}`)
  out.push(`  ${c.dim(removeHint(state))}`)
  return out.join('\n')
}

function autostart(state) {
  if (state.mode === 'docker') return 'yes · Docker restart policy'
  if (state.service.installed) return `at login (${state.service.running ? 'running' : 'not running'}) · A turns it off`
  if (state.plugin) return 'with Herdr (plugin startup) · A: also at login'
  return 'no · A: at login'
}

export function removeHint(state) {
  if (!state.plugin) return 'Remove: wherdr service uninstall, then npm rm -g wherdr'
  const dir = state.dir === path.join(os.homedir(), 'wherdr') ? '~/wherdr' : state.dir
  const id = process.env.HERDR_PLUGIN_ID || 'wherdr'
  return state.service.installed
    ? `Remove: A (login service), X, then herdr plugin uninstall ${id} && rm -rf ${dir}`
    : `Remove: X, then herdr plugin uninstall ${id} && rm -rf ${dir}`
}

async function qr(text) {
  try {
    const { default: qrcode } = await import('qrcode-terminal')
    const { promise, resolve } = Promise.withResolvers()
    qrcode.generate(text, { small: true }, resolve)
    return await promise
  } catch { return '' }
}

export async function panel(opts) {
  if (!process.stdin.isTTY) throw new Error('wherdr panel needs a terminal.')
  const ctx = context(opts)
  let control = null
  try { control = process.env.WHERDR_CONTROL ? JSON.parse(process.env.WHERDR_CONTROL) : null } catch {}
  let state = null
  let net = null
  let netAt = 0
  let qrFor = ''
  let qrText = ''
  let busy = false
  let timer = null

  const draw = async () => {
    if (Date.now() - netAt > 30_000) { net = null; netAt = Date.now() }
    state = await gather(ctx, process.env, net)
    net = state.tailnet
    const url = state.tailnet.phone?.served ? state.tailnet.phone.url : ''
    if (url !== qrFor) { qrFor = url; qrText = url ? await qr(url) : '' }
    if (!busy) process.stdout.write(`\x1b[H\x1b[2J${render(state, qrText)}\n`)
  }
  const schedule = () => { clearTimeout(timer); timer = setTimeout(() => draw().finally(schedule), 3000) }

  const raw = on => { process.stdin.setRawMode(on); process.stdout.write(on ? '\x1b[?25l' : '\x1b[?25h') }
  const quit = () => { clearTimeout(timer); raw(false); process.stdout.write('\x1b[H\x1b[2J'); process.exit(0) }

  const runKey = async (key) => {
    const argv = keyCommand(key, state, control)
    busy = true
    clearTimeout(timer)
    process.stdin.off('data', onKey)
    raw(false)
    process.stdout.write('\x1b[H\x1b[2J\n')
    if (!argv) {
      process.stdout.write('  Update the wherdr command with your package manager:\n    npm install -g wherdr@latest   (or bun add -g / pnpm add -g)\n')
    } else {
      // Ctrl+C stops the command (the log follower), not the panel.
      const ignore = () => {}
      process.on('SIGINT', ignore)
      const child = spawn(argv[0], argv.slice(1), { stdio: 'inherit', env: process.env })
      await new Promise(resolve => child.on('exit', resolve).on('error', (e) => { process.stdout.write(`  ✗ ${e.message}\n`); resolve() }))
      process.off('SIGINT', ignore)
    }
    if (key === 'a' || key === 'x' || key === 's' || key === 'r') netAt = 0
    process.stdout.write(`\n  ${c.dim('Press any key to go back.')}`)
    raw(true)
    process.stdin.once('data', async () => {
      busy = false
      process.stdin.on('data', onKey)
      await draw()
      schedule()
    })
  }

  const onKey = (buf) => {
    const key = buf.toString('utf8').toLowerCase()
    if (key === 'q' || key === '\x03' || key === '\x1b') return quit()
    if (busy || !state) return
    if (KEYS.some(([k]) => k === key)) runKey(key)
  }

  process.on('SIGTERM', quit)
  process.on('SIGHUP', quit)
  raw(true)
  process.stdin.resume()
  process.stdin.on('data', onKey)
  process.stdout.write('\x1b[H\x1b[2J\n  wherdr…')
  await draw()
  schedule()
  await new Promise(() => {})
}
