#!/usr/bin/env node
// `npx wherdr`, `bunx wherdr`, `pnpm dlx wherdr`: runs the prebuilt server
// shipped in the package (.output/server/index.mjs); nothing is built here.
import { spawn } from 'node:child_process'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SERVER = path.join(ROOT, '.output', 'server', 'index.mjs')

export const HELP = `wherdr: your Herdr agents from your phone and browser.

Usage: wherdr [options]

Options:
  --port <n>        Listening port (default: 7683, or $PORT)
  --host <addr>     Listening address (default: 127.0.0.1, or $HOST). Keep it on loopback.
  --data-dir <dir>  Passkeys, push keys and settings (default: ~/wherdr/data, or $DATA_DIR),
                    the folder used by the Herdr plugin and the install script
  --session <name>  Named Herdr session to drive (default: the default session,
                    or $HERDR_WEB_SESSION)
  -v, --version     Print the version
  -h, --help        Print this help

Every other setting is an environment variable (APP_URL, HOST_LABEL, HERDR_BIN…):
https://wherdr.dev (and the README: Configuration)`

const OPTIONS = { '--port': 'port', '--host': 'host', '--data-dir': 'dataDir', '--session': 'session' }

// argv without the runtime and script: { port, host, dataDir, session, help, version }.
// Throws an Error with a user-facing message on bad input.
export function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '-h' || arg === '--help') { out.help = true; continue }
    if (arg === '-v' || arg === '--version') { out.version = true; continue }
    const eq = arg.indexOf('=')
    const name = eq > 0 ? arg.slice(0, eq) : arg
    const key = OPTIONS[name]
    if (!key) throw new Error(`unknown option: ${arg} (see wherdr --help)`)
    const value = eq > 0 ? arg.slice(eq + 1) : argv[++i]
    if (value === undefined || value === '' || (eq < 0 && value.startsWith('--'))) throw new Error(`${name} needs a value`)
    out[key] = value
  }
  if (out.port !== undefined && !/^\d+$/.test(out.port)) throw new Error(`--port must be a number (got: ${out.port})`)
  if (out.port !== undefined && (Number(out.port) < 1 || Number(out.port) > 65535)) throw new Error(`--port must be between 1 and 65535 (got: ${out.port})`)
  return out
}

function expandHome(p, home) {
  return p === '~' ? home : p.startsWith('~/') ? path.join(home, p.slice(2)) : p
}

// Environment of the server: options win over the environment, which wins over the defaults.
export function serverEnv(opts, env, home = os.homedir()) {
  const out = { ...env }
  out.PORT = opts.port ?? env.PORT ?? '7683'
  out.HOST = opts.host ?? env.HOST ?? '127.0.0.1'
  out.DATA_DIR = path.resolve(expandHome(opts.dataDir ?? env.DATA_DIR ?? path.join(home, 'wherdr', 'data'), home))
  if (opts.session !== undefined) out.HERDR_WEB_SESSION = opts.session
  out.NODE_ENV = 'production'
  // Open WebSockets do not hold Ctrl+C for 30 s; clients reconnect on their own.
  out.NITRO_SHUTDOWN_TIMEOUT ??= '1500'
  // Update command offered in the app (shared/updates.ts).
  out.WHERDR_INSTALL = 'npm'
  // Nitro reads NITRO_PORT / NITRO_HOST before PORT / HOST.
  delete out.NITRO_PORT
  delete out.NITRO_HOST
  return out
}

// Free → null; taken → 'wherdr' when it answers like wherdr, 'other' otherwise;
// unusable for another reason (privileged port, unknown address) → the error message.
export function portTaken(port, host) {
  const { promise, resolve } = Promise.withResolvers()
  const srv = net.createServer()
  srv.once('error', async (err) => {
    if (err.code !== 'EADDRINUSE') { resolve({ error: `cannot listen on ${host}:${port} (${err.code || err.message}).` }); return }
    resolve(await probe(port, host))
  })
  srv.listen(Number(port), host, () => srv.close(() => resolve(null)))
  return promise
}

async function probe(port, host) {
  const h = host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host
  try {
    const res = await fetch(`http://${h.includes(':') ? `[${h}]` : h}:${port}/manifest.webmanifest`, { signal: AbortSignal.timeout(2000) })
    // A locked wherdr answers 401 on its API, not on its manifest.
    return res.ok && (await res.text()).includes('wherdr') ? 'wherdr' : 'other'
  } catch { return 'other' }
}

function hasNode() {
  const { promise, resolve } = Promise.withResolvers()
  const p = spawn('node', ['--version'], { stdio: ['ignore', 'pipe', 'ignore'] })
  let out = ''
  p.stdout.on('data', (d) => { out += d })
  p.on('error', () => resolve(false))
  p.on('close', code => resolve(code === 0 && Number(/^v(\d+)/.exec(out)?.[1]) >= 22))
  return promise
}

function fail(msg, code = 1) {
  process.stderr.write(`wherdr: ${msg}\n`)
  process.exit(code)
}

async function main() {
  let opts
  try { opts = parseArgs(process.argv.slice(2)) } catch (e) { fail(e.message, 2) }
  const version = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version
  if (opts.help) { process.stdout.write(`${HELP}\n`); return }
  if (opts.version) { process.stdout.write(`${version}\n`); return }

  const bun = process.versions.bun
  const major = Number(process.versions.node.split('.')[0])
  if (!bun && major < 22) fail(`Node.js 22 or newer is required (found ${process.version}).`)
  if (!existsSync(SERVER)) fail(`the server is missing (${SERVER}): this copy of wherdr was not built. Run \`npm run build\` in a checkout.`)

  const env = serverEnv(opts, process.env)
  const taken = await portTaken(env.PORT, env.HOST)
  if (taken === 'wherdr') fail(`a wherdr already runs on port ${env.PORT}: open http://localhost:${env.PORT}, or start another one with --port.`)
  if (taken?.error) fail(taken.error)
  if (taken) fail(`port ${env.PORT} is already taken by another program: pick another one with --port.`)

  process.stdout.write(`wherdr ${version} · http://localhost:${env.PORT} · data ${env.DATA_DIR}${env.HERDR_WEB_SESSION ? ` · session ${env.HERDR_WEB_SESSION}` : ''}\n`)

  // Bun runs the server (WebSockets, web-push, passkeys, Herdr's Unix socket),
  // but Node stays the reference runtime: use it when it is there.
  if (bun && process.env.WHERDR_RUNTIME !== 'bun' && await hasNode()) {
    const child = spawn('node', [SERVER], { env, stdio: 'inherit' })
    for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => child.kill(sig))
    child.on('exit', (code, sig) => process.exit(code ?? (sig ? 1 : 0)))
    return
  }
  Object.assign(process.env, env)
  for (const k of ['NITRO_PORT', 'NITRO_HOST']) delete process.env[k]
  await import(pathToFileURL(SERVER).href)
}

// Run only as a command (npx links bin/wherdr.mjs: compare real paths), not when imported by the tests.
const invoked = process.argv[1] && (() => { try { return realpathSync(process.argv[1]) } catch { return '' } })()
if (invoked === realpathSync(fileURLToPath(import.meta.url))) await main()
