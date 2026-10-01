// Terminal: relay of `herdr terminal session control`.
// The CLI speaks line-delimited JSON on stdin/stdout:
//   output: {"type":"terminal.frame","encoding":"ansi","full":bool,"width","height","seq","bytes":<b64>}
//            {"type":"terminal.closed","reason":…}
//   input: terminal.input {text|bytes}, terminal.resize {cols,rows},
//            terminal.scroll {direction:up|down,lines}, terminal.release
// Only one "attached" client per terminal: without --takeover, the connection is
// refused if someone else already is; with it, the other one is detached.
// Pane of a remote machine: the same CLI, launched on that machine over the
// multiplexed SSH connection (stdin/stdout relayed as is).
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import readline from 'node:readline'
import { PANE_RE, log } from './env'
import { herdr } from './herdr'
import { termSessions, type TermView } from './state'
import { machineOfPane } from './machines'
import { splitId } from '../../shared/ids'

export const clampInt = (v: unknown, lo: number, hi: number, dflt: number) => {
  const n = parseInt(String(v), 10)
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt
}

// What the relay needs from a WebSocket (crossws or other).
export interface WsLike {
  send: (data: string) => void
  close: (code?: number, reason?: string) => void
  isOpen: () => boolean
}

export interface TermSession {
  onMessage: (raw: string) => void
  onClose: () => void
}

export function openTerm(ws: WsLike, url: URL): TermSession | null {
  const pane = url.searchParams.get('pane') || ''
  if (!PANE_RE.test(pane)) {
    ws.close(4400, 'pane invalide')
    return null
  }
  const machine = machineOfPane(pane)
  if (!machine || !machine.sock()) {
    ws.send(JSON.stringify({ type: 'terminal.closed', reason: machine ? `${machine.label} injoignable` : 'machine inconnue', code: machine ? 'unreachable' : 'unknown_machine', machine: machine?.label }))
    ws.close(4503, 'machine injoignable')
    return null
  }
  const cols = clampInt(url.searchParams.get('cols'), 10, 400, 80)
  const rows = clampInt(url.searchParams.get('rows'), 5, 200, 24)
  const args = ['terminal', 'session', 'control', splitId(pane).local, '--cols', String(cols), '--rows', String(rows)]
  if (url.searchParams.get('takeover') === '1') args.push('--takeover')

  const child: ChildProcessWithoutNullStreams = machine.spawnHerdr(args)
  const sess: TermView = { pane, visible: true }
  termSessions.add(sess)
  log(`term ${pane} ouvert ${cols}x${rows}${args.includes('--takeover') ? ' (takeover)' : ''}${machine.local ? '' : ` sur ${machine.label}`}`)

  readline.createInterface({ input: child.stdout }).on('line', (line) => {
    if (ws.isOpen()) ws.send(line)
  })
  readline.createInterface({ input: child.stderr }).on('line', (line) => {
    log(`term ${pane} stderr: ${line}`)
    if (ws.isOpen()) ws.send(JSON.stringify({ type: 'herdr.stderr', message: line }))
  })
  child.on('error', (e) => {
    if (ws.isOpen()) ws.send(JSON.stringify({ type: 'terminal.closed', reason: `herdr: ${e.message}` }))
    ws.close(4500, 'herdr error')
  })
  child.on('exit', (code) => {
    termSessions.delete(sess)
    if (ws.isOpen()) ws.close(4000, `herdr exit ${code}`)
  })
  // No crash if the CLI closes while we write to it.
  child.stdin.on('error', () => {})

  const toChild = (obj: unknown) => {
    if (child.stdin.writable) child.stdin.write(JSON.stringify(obj) + '\n')
  }

  return {
    onMessage(raw: string) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let m: any
      try { m = JSON.parse(raw) }
      catch { return }
      switch (m && m.type) {
        case 'terminal.input':
          if (typeof m.text === 'string' && m.text.length <= 65536) toChild({ type: 'terminal.input', text: m.text })
          else if (typeof m.bytes === 'string' && m.bytes.length <= 90000) toChild({ type: 'terminal.input', bytes: m.bytes })
          break
        case 'terminal.resize':
          toChild({ type: 'terminal.resize', cols: clampInt(m.cols, 10, 400, cols), rows: clampInt(m.rows, 5, 200, rows) })
          break
        case 'terminal.scroll':
          if (m.direction === 'up' || m.direction === 'down') {
            toChild({ type: 'terminal.scroll', direction: m.direction, lines: clampInt(m.lines, 1, 500, 3) })
          }
          break
        case 'keys': // logical keys encoded by Herdr according to the terminal mode
          if (Array.isArray(m.keys) && m.keys.length <= 32 && m.keys.every((k: unknown) => typeof k === 'string' && k.length <= 24)) {
            herdr('pane.send_input', { pane_id: pane, keys: m.keys }).catch(e =>
              ws.isOpen() && ws.send(JSON.stringify({ type: 'web.error', code: e.code, message: e.message })))
          }
          break
        case 'visibility':
          sess.visible = Boolean(m.visible)
          break
      }
    },
    onClose() {
      termSessions.delete(sess)
      // Hand control back cleanly (the pane size goes back to the other clients).
      toChild({ type: 'terminal.release' })
      child.stdin.end()
      setTimeout(() => {
        if (child.exitCode === null) child.kill('SIGTERM')
      }, 1500)
    },
  }
}
