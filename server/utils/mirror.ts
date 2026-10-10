// Mirror of a pane: `herdr terminal session observe` relayed as is. An
// observer does not attach to the terminal: it changes neither its size, nor the
// focus, nor the client in control. It must be given the real
// terminal's size (see paneScreen); it is re-checked now and then and
// the observer restarted if it changed. Read only: the keystrokes of a
// side-by-side cell go through its terminal (terminal.ts).
//   output: Herdr's frames, preceded by {"type":"mirror.size",cols,rows}
// `hold=1`: the cell's terminal fitted the pane to the cell, and the focus went
// to another cell. The mirror keeps that size (no Herdr client attached would
// lay the pane out again) until it closes: the pane then gets its own back, as
// after a terminal (paneSizes.ts). Its cell resized meanwhile (window, divider):
//   input: {"type":"fit",cols,rows}, applied as long as the pane still has the
//   size wherdr gave it (a Herdr client that laid it out again keeps its own).
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import readline from 'node:readline'
import { PANE_RE, log } from './env'
import { herdr } from './herdr'
import { getState } from './state'
import { machineOfPane } from './machines'
import { type TermSession, type WsLike, askedPaneSize, clampInt, holdPaneSize, readPaneSize, resizePane } from './terminal'
import { splitId } from '../../shared/ids'
import { mirrorSize } from '../../shared/spaces'
import { fmt } from '../../shared/message'

const RECHECK_MS = 8000
// The cell's terminal was just closed: the pane's size settles within a second or two.
const HELD_RECHECK_MS = 2000
// Borne : quelques miroirs par onglet, quelques onglets ouverts.
const MAX_MIRRORS = 24
let open = 0

const layoutRect = (pane: string) => {
  const tab = (getState().tabs || []).find(t => t.layout?.panes.some(x => x.pane === pane))
  return tab?.layout?.panes.find(x => x.pane === pane)?.rect || null
}

// What tells, cheaply, that a pane may have been resized: its rows, its place
// in Herdr's layout, the size wherdr gave it.
async function sizeHint(pane: string) {
  const info = await herdr('pane.get', { pane_id: pane }, 4000).catch(() => null)
  const rect = layoutRect(pane)
  const asked = askedPaneSize(pane)
  return [info?.pane?.scroll?.viewport_rows, rect?.width, rect?.height, asked?.cols, asked?.rows].join(' ')
}

// Size of the pane's screen: the PTY's when it can be asked, then the one
// wherdr gave it, otherwise an estimate (see mirrorSize).
async function paneScreen(pane: string) {
  const real = await readPaneSize(pane).catch(() => null)
  if (real?.exact) return mirrorSize({ rows: real.rows, rect: { width: real.cols, height: real.rows } })
  const asked = askedPaneSize(pane)
  if (asked && (!real || real.rows === asked.rows)) return mirrorSize({ rows: asked.rows, rect: { width: asked.cols, height: asked.rows } })
  const [info, read] = await Promise.all([
    herdr('pane.get', { pane_id: pane }, 4000).catch(() => null),
    herdr('pane.read', { pane_id: pane, source: 'visible' }, 4000).catch(() => null),
  ])
  return mirrorSize({ rows: info?.pane?.scroll?.viewport_rows, text: read?.read?.text, rect: layoutRect(pane) })
}

export function openMirror(ws: WsLike, url: URL): TermSession | null {
  const pane = url.searchParams.get('pane') || ''
  if (!PANE_RE.test(pane)) {
    ws.close(4400, 'Invalid pane')
    return null
  }
  const machine = machineOfPane(pane)
  if (!machine || !machine.sock()) {
    ws.send(JSON.stringify({ type: 'terminal.closed', reason: machine ? fmt('{machine} is unreachable', { machine: machine.label }) : 'unknown machine', code: machine ? 'unreachable' : 'unknown_machine', machine: machine?.label }))
    ws.close(4503, 'machine unreachable')
    return null
  }
  if (open >= MAX_MIRRORS) {
    ws.close(4429, 'trop de miroirs')
    return null
  }
  open++
  let child: ChildProcessWithoutNullStreams | null = null
  let size = { cols: 0, rows: 0 }
  let closed = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let hint = ''
  const hold = url.searchParams.get('hold') === '1' ? holdPaneSize(pane) : null

  function stopChild() {
    const c = child
    child = null
    if (c && c.exitCode === null) c.kill('SIGTERM')
  }
  function start(next: { cols: number, rows: number }) {
    stopChild()
    size = next
    if (ws.isOpen()) ws.send(JSON.stringify({ type: 'mirror.size', ...size }))
    const c = machine!.spawnHerdr(['terminal', 'session', 'observe', splitId(pane).local, '--cols', String(size.cols), '--rows', String(size.rows)])
    child = c
    readline.createInterface({ input: c.stdout }).on('line', (line) => {
      if (child === c && ws.isOpen()) ws.send(line)
    })
    readline.createInterface({ input: c.stderr }).on('line', line => log(`mirror ${pane} stderr: ${line}`))
    c.on('error', () => {})
    c.on('exit', () => {
      if (child === c && !closed) ws.close(4000, 'observe ended')
    })
    c.stdin.on('error', () => {})
  }
  // One check at a time: a fit asks for one at once, over the pending one.
  let round = 0
  async function recheck() {
    if (closed) return
    const mine = ++round
    clearTimeout(timer)
    const now = await sizeHint(pane)
    if (closed || mine !== round) return
    if (now !== hint) {
      hint = now
      const next = await paneScreen(pane).catch(() => null)
      if (closed || mine !== round) return
      if (next && (next.cols !== size.cols || next.rows !== size.rows)) {
        log(`mirror ${pane}: ${size.cols}x${size.rows} -> ${next.cols}x${next.rows}`)
        start(next)
      }
    }
    timer = setTimeout(recheck, hold ? HELD_RECHECK_MS : RECHECK_MS)
  }
  // A held pane: its size is read once the hold has it (a restore under way is over).
  Promise.resolve(hold).then(async () => {
    hint = await sizeHint(pane)
    return paneScreen(pane)
  }).then((s) => {
    if (closed) return
    start(s)
    timer = setTimeout(recheck, hold ? HELD_RECHECK_MS : RECHECK_MS)
  }).catch(() => ws.close(4500, 'pane illisible'))

  let fitting = false
  async function fit(cols: number, rows: number) {
    const h = await hold
    const asked = askedPaneSize(pane)
    if (!h || closed || fitting || !asked || (asked.cols === cols && asked.rows === rows)) return
    fitting = true
    try {
      const real = await readPaneSize(pane).catch(() => null)
      if (!real || real.rows !== asked.rows || (real.exact && real.cols !== asked.cols)) return
      if (closed || !await resizePane(pane, cols, rows)) return
      h.resized(cols, rows)
      await recheck()
    } finally { fitting = false }
  }

  return {
    onMessage(raw: string) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let m: any
      try { m = JSON.parse(raw) }
      catch { return }
      if (hold && m?.type === 'fit') fit(clampInt(m.cols, 10, 400, 80), clampInt(m.rows, 5, 200, 24)).catch(() => {})
    },
    onClose(clean = false) {
      if (closed) return
      closed = true
      open--
      clearTimeout(timer)
      stopChild()
      hold?.then(h => h.release(clean))
    },
  }
}
