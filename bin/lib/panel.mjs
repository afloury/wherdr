// `wherdr panel`: the Herdr plugin's "wherdr" action opens it in a popup.
// The state, and two main keys: O opens wherdr, P opens its phone setup
// (Settings › Phone) in the browser. The other commands stay as a fallback,
// in a quieter line. Refreshed every few seconds.
//
// Commands run through a controller: `wherdr` itself, or the Herdr plugin
// script when WHERDR_CONTROL holds its argv as JSON (it knows Docker mode).
import { spawn } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { BIN, VERSION, c, probe } from './core.mjs'
import { context, livePid, openUrl, phoneSetupUrl } from './commands.mjs'
import { serviceFile, serviceState } from './service.mjs'
import { inspect, reachable } from './tailnet.mjs'

export const MAIN_KEYS = [['o', 'Open wherdr'], ['p', 'Set up my phone']]
export const OTHER_KEYS = [
  ['s', 'start'], ['x', 'stop'], ['r', 'restart'], ['l', 'log'], ['u', 'update'], ['a', 'auto-start'], ['q', 'quit'],
]

// argv of the controller (`wherdr` or the plugin script) for a panel key;
// P opens the browser itself (see panel()).
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
    default: return null
  }
}

// Tailscale's state plus whether the phone address really answers like wherdr.
export async function tailnet(port) {
  const net = await inspect(port)
  return net.phone?.served ? { ...net, reach: await reachable(net.phone.url, 5000) } : net
}

export async function gather(ctx, env = process.env, net = null) {
  const answer = await probe(ctx.port, ctx.host)
  const mode = env.WHERDR_MODE === 'docker' ? 'docker' : 'native'
  return {
    version: VERSION,
    mode,
    plugin: Boolean(env.WHERDR_CONTROL),
    runtime: process.versions.bun ? `bun ${process.versions.bun}` : `node ${process.versions.node}`,
    url: ctx.url,
    port: ctx.port,
    answer,
    pid: livePid(ctx.files.pid),
    service: mode === 'docker' ? { installed: false, running: false } : serviceState(),
    serviceFile: serviceFile(),
    dir: ctx.dir,
    tailnet: net ?? await tailnet(ctx.port),
  }
}

// The phone address only counts once it answers: then the QR code.
export const phoneReady = state => Boolean(state.tailnet.phone?.served && state.tailnet.reach === 'ok')

const line = (label, value) => `  ${c.dim(label.padEnd(9))}${value}`

function phoneLine(state) {
  const net = state.tailnet
  if (phoneReady(state)) return c.cyan(net.phone.url)
  if (!net.installed) return `${c.yellow('no Tailscale on this machine')} ${c.dim('· P')}`
  if (!net.connected || !net.phone) return `${c.yellow('Tailscale is not connected')} ${c.dim('· P')}`
  if (net.phone.served) return `${c.dim(net.phone.url)} ${c.yellow('not answering yet')} ${c.dim('· P')}`
  return `${c.yellow('Not reachable from your phone yet')} ${c.dim('· P')}`
}

export function render(state, qrText = '') {
  const out = []
  out.push(`  ${c.bold('WHERDR')}  ${c.dim(state.version)}`)
  out.push(`  ${c.dim('─'.repeat(56))}`)
  const status = state.answer === 'wherdr' ? `${c.green('●')} running`
    : state.answer ? `${c.yellow('●')} port ${state.port} is taken by another program`
      : `${c.dim('○')} stopped`
  out.push(line('STATUS', status))
  out.push(line('LOCAL', c.cyan(state.url)))
  out.push(line('PHONE', phoneLine(state)))
  out.push('')
  if (phoneReady(state) && qrText) {
    out.push(`  ${c.dim('SCAN WITH THE IPHONE CAMERA, THEN SHARE → ADD TO HOME SCREEN')}`)
    for (const l of qrText.trimEnd().split('\n')) out.push(`  ${l}`)
    out.push('')
  }
  out.push(`  ${MAIN_KEYS.map(([k, label]) => `${c.bold(k.toUpperCase())} ${label}`).join('    ')}`)
  out.push('')
  out.push(`  ${c.dim(OTHER_KEYS.map(([k, label]) => `${k.toUpperCase()} ${label}`).join('  '))}`)
  out.push(`  ${c.dim(`${state.mode === 'docker' ? 'Docker' : `native · ${state.runtime}`} · auto-start ${autostart(state)}`)}`)
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
    // A phone address that does not answer yet is checked again sooner.
    if (Date.now() - netAt > (net && !phoneReady({ tailnet: net }) ? 10_000 : 30_000)) { net = null; netAt = Date.now() }
    state = await gather(context(opts), process.env, net)
    net = state.tailnet
    const url = phoneReady(state) ? state.tailnet.phone.url : ''
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
    if (key === 'p') {
      // The phone setup is a page of the app: publish, live check, QR code.
      const setup = phoneSetupUrl(state.url)
      if (state.answer !== 'wherdr') process.stdout.write('  wherdr is not running: press S first, then P.\n')
      else if (openUrl(setup)) process.stdout.write(`  Opened ${setup} in the browser.\n  Set up your phone there: the QR code shows up once the address answers.\n`)
      else process.stdout.write(`  Open ${setup} in a browser on this computer.\n`)
    } else if (!argv) {
      process.stdout.write('  Update the wherdr command with your package manager:\n    npm install -g wherdr@latest   (or bun add -g / pnpm add -g)\n')
    } else {
      // Ctrl+C stops the command (the log follower), not the panel.
      const ignore = () => {}
      process.on('SIGINT', ignore)
      const child = spawn(argv[0], argv.slice(1), { stdio: 'inherit', env: process.env })
      await new Promise(resolve => child.on('exit', resolve).on('error', (e) => { process.stdout.write(`  ✗ ${e.message}\n`); resolve() }))
      process.off('SIGINT', ignore)
    }
    if (key !== 'l' && key !== 'o') netAt = 0
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
    if ([...MAIN_KEYS, ...OTHER_KEYS].some(([k]) => k === key)) runKey(key)
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
