// Fake `herdr` CLI for the end-to-end tests: only `terminal session control`
// (the terminal's control session, see server/utils/terminal.ts), played
// against the fake Herdr server, and `terminal session observe` (a mirror, see
// server/utils/mirror.ts), which draws one screen; every other command fails.
//   node fake-herdr-cli.mjs <socket> [--session <name>] terminal session control <pane> [--takeover] --cols N --rows N
//   node fake-herdr-cli.mjs <socket> [--session <name>] terminal session observe <pane> --cols N --rows N
import net from 'node:net'
import readline from 'node:readline'

const [sock, ...argv] = process.argv.slice(2)
const args = argv[0] === '--session' ? argv.slice(2) : argv

function call(method, params) {
  return new Promise((resolve, reject) => {
    const conn = net.createConnection(sock)
    let buf = ''
    conn.setEncoding('utf8')
    conn.on('error', reject)
    conn.on('connect', () => conn.write(JSON.stringify({ id: 'cli', method, params }) + '\n'))
    conn.on('data', (chunk) => { buf += chunk })
    conn.on('end', () => {
      try {
        const res = JSON.parse(buf)
        if (res.error) reject(new Error(res.error.message))
        else resolve(res.result)
      } catch (e) { reject(e) }
    })
  })
}

const command = args.slice(0, 3).join(' ')
if (command !== 'terminal session control' && command !== 'terminal session observe') {
  console.error('herdr is not available in the e2e tests')
  process.exit(1)
}

const pane = args[3]
const opt = name => Number(args[args.indexOf(name) + 1])
const session = `cli-${process.pid}`
const out = obj => process.stdout.write(JSON.stringify(obj) + '\n')
let seq = 0
const frame = (size, what = 'terminal') => out({
  type: 'terminal.frame', encoding: 'ansi', full: true, width: size.cols, height: size.rows, seq: ++seq,
  bytes: Buffer.from(`\x1b[2J\x1b[Hfake ${what} ${size.cols}x${size.rows}\r\n$ `).toString('base64'),
})

// An observer attaches to nothing: the screen at the size it was given, until it is stopped.
if (command === 'terminal session observe') {
  frame({ cols: opt('--cols'), rows: opt('--rows') }, 'mirror')
  process.on('SIGTERM', () => process.exit(0))
  process.stdin.on('close', () => process.exit(0)).resume()
  await new Promise(() => {})
}

let done = false
async function leave(code) {
  if (done) return
  done = true
  await call('e2e.term_detach', { pane_id: pane, session }).catch(() => {})
  process.exit(code)
}

try {
  frame(await call('e2e.term_attach', { pane_id: pane, session, cols: opt('--cols'), rows: opt('--rows'), takeover: args.includes('--takeover') }))
} catch (e) {
  out({ type: 'terminal.closed', reason: e.message })
  process.exit(1)
}

readline.createInterface({ input: process.stdin }).on('line', async (line) => {
  let m
  try { m = JSON.parse(line) }
  catch { return }
  if (m.type === 'terminal.resize') {
    const size = await call('e2e.term_resize', { pane_id: pane, session, cols: m.cols, rows: m.rows }).catch(() => null)
    if (size) frame(size)
    else {
      // Another session took the terminal over.
      out({ type: 'terminal.closed', reason: 'taken over' })
      leave(0)
    }
  } else if (m.type === 'terminal.release') {
    out({ type: 'terminal.closed', reason: 'detached' })
    leave(0)
  }
}).on('close', () => leave(0))
process.on('SIGTERM', () => leave(0))
