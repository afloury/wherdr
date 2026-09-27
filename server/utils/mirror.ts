// Miroir d'un pane : `herdr terminal session observe` relayé tel quel. Un
// observateur ne s'attache pas au terminal : il ne change ni sa taille, ni le
// focus, ni le client qui a la main. Il faut lui donner la taille du vrai
// terminal (cf. mirrorSize) ; elle est revérifiée de temps en temps et
// l'observateur relancé si elle a changé. Frappes (case cliquée) : envoyées
// par `pane.send_input`, texte ou touches nommées, sans prendre la main.
//   sortie : les frames de Herdr, précédées de {"type":"mirror.size",cols,rows}
//   entrée : {"type":"input","text"} | {"type":"input","keys":[…]}
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import readline from 'node:readline'
import { PANE_RE, log } from './env'
import { herdr } from './herdr'
import { getState } from './state'
import { machineOfPane } from './machines'
import type { TermSession, WsLike } from './terminal'
import { splitId } from '../../shared/ids'
import { mirrorSize } from '../../shared/spaces'

const RECHECK_MS = 8000
// Borne : quelques miroirs par onglet, quelques onglets ouverts.
const MAX_MIRRORS = 24
let open = 0

async function probe(pane: string) {
  const [info, read] = await Promise.all([
    herdr('pane.get', { pane_id: pane }, 4000).catch(() => null),
    herdr('pane.read', { pane_id: pane, source: 'visible' }, 4000).catch(() => null),
  ])
  const tab = (getState().tabs || []).find(t => t.layout?.panes.some(x => x.pane === pane))
  const rect = tab?.layout?.panes.find(x => x.pane === pane)?.rect || null
  return mirrorSize({ rows: info?.pane?.scroll?.viewport_rows, text: read?.read?.text, rect })
}

export function openMirror(ws: WsLike, url: URL): TermSession | null {
  const pane = url.searchParams.get('pane') || ''
  if (!PANE_RE.test(pane)) {
    ws.close(4400, 'pane invalide')
    return null
  }
  const machine = machineOfPane(pane)
  if (!machine || !machine.sock()) {
    ws.send(JSON.stringify({ type: 'terminal.closed', reason: machine ? `${machine.label} injoignable` : 'machine inconnue' }))
    ws.close(4503, 'machine injoignable')
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
    readline.createInterface({ input: c.stderr }).on('line', line => log(`miroir ${pane} stderr: ${line}`))
    c.on('error', () => {})
    c.on('exit', () => {
      if (child === c && !closed) ws.close(4000, 'observe terminé')
    })
    c.stdin.on('error', () => {})
  }
  async function recheck() {
    if (closed) return
    const next = await probe(pane).catch(() => null)
    if (closed) return
    if (next && (next.cols !== size.cols || next.rows !== size.rows)) {
      log(`miroir ${pane} : ${size.cols}x${size.rows} -> ${next.cols}x${next.rows}`)
      start(next)
    }
    timer = setTimeout(recheck, RECHECK_MS)
  }
  probe(pane).then((s) => {
    if (closed) return
    start(s)
    timer = setTimeout(recheck, RECHECK_MS)
  }).catch(() => ws.close(4500, 'pane illisible'))

  return {
    onMessage(raw: string) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let m: any
      try { m = JSON.parse(raw) }
      catch { return }
      if (!m || m.type !== 'input') return
      let params: Record<string, unknown> | null = null
      if (typeof m.text === 'string' && m.text && m.text.length <= 65536) params = { pane_id: pane, text: m.text }
      else if (Array.isArray(m.keys) && m.keys.length && m.keys.length <= 32 && m.keys.every((k: unknown) => typeof k === 'string' && k.length <= 24)) params = { pane_id: pane, keys: m.keys }
      if (!params) return
      herdr('pane.send_input', params).catch(e => ws.isOpen() && ws.send(JSON.stringify({ type: 'web.error', code: e.code, message: e.message })))
    },
    onClose() {
      if (closed) return
      closed = true
      open--
      clearTimeout(timer)
      stopChild()
    },
  }
}
