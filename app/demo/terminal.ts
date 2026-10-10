// Terminal view of the demo: a drawn screen per pane (agents: their
// conversation the way a TUI would show it; the dev server: its recorded
// output), and a line editor that never runs what is typed.
import type { ChatItem, Pane } from '#shared/types'
import { DEV_SERVER_OUTPUT } from './scenario'

const DIM = '\x1b[2m'
const BOLD = '\x1b[1m'
const RESET = '\x1b[0m'
const ACCENT = '\x1b[38;5;209m'
const CYAN = '\x1b[36m'

// Visible width of a line without its ANSI sequences.
const plain = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '')

function wrap(text: string, width: number): string[] {
  const out: string[] = []
  for (const raw of text.split('\n')) {
    let line = raw
    while (line.length > width) {
      const cut = line.lastIndexOf(' ', width) > width / 2 ? line.lastIndexOf(' ', width) : width
      out.push(line.slice(0, cut))
      line = line.slice(cut).trimStart()
    }
    out.push(line)
  }
  return out
}

function itemLines(it: ChatItem, width: number): string[] {
  const w = Math.max(20, width - 4)
  switch (it.role) {
    case 'user': return ['', ...wrap(it.text, w).map((l, i) => `${DIM}${i ? '  ' : '> '}${RESET}${BOLD}${l}${RESET}`)]
    case 'assistant': return ['', ...wrap(it.text.replace(/\*\*|`/g, ''), w).map((l, i) => `${i ? '  ' : `${ACCENT}⏺${RESET} `}${l}`)]
    case 'thinking': return ['', ...wrap(it.text, w).map(l => `${DIM}  ${l}${RESET}`)]
    case 'tool': return [`${CYAN}⏺${RESET} ${BOLD}${it.name || 'Tool'}${RESET}${DIM}(${it.text.slice(0, w - (it.name || '').length - 4)})${RESET}`]
    default: return [`${DIM}  ${it.text}${RESET}`]
  }
}

// Whole screen of an agent pane: conversation tail, activity, input box.
export function agentScreen(p: Pane, items: ChatItem[], input: string, cols: number, rows: number): string {
  const body = items.flatMap(it => itemLines(it, cols))
  const status = p.status === 'working'
    ? `${ACCENT}✻${RESET} ${p.activity || p.ompActivity?.step || 'Working'}… ${DIM}(esc to interrupt)${RESET}`
    : p.status === 'blocked' ? `${ACCENT}?${RESET} Waiting for your answer` : ''
  const rule = `${DIM}${'─'.repeat(Math.max(10, cols - 1))}${RESET}`
  const footer = ['', status, rule, `${BOLD}>${RESET} ${input}`, rule, `${DIM}  ${p.model?.label || ''} · demo — nothing runs${RESET}`]
  const room = Math.max(1, rows - footer.length)
  const lines = [...body.slice(-room)]
  const screen = [...lines, ...footer].map(l => (plain(l).length > cols ? l.slice(0, cols) : l)).join('\r\n')
  // The cursor waits in the input field, after what is typed.
  return `\x1b[2J\x1b[H${screen}\x1b[${lines.length + 4};${Math.min(cols, input.length + 3)}H`
}

export const DEV_SERVER_SCREEN = '\x1b[2J\x1b[H' + DEV_SERVER_OUTPUT.join('\r\n') + '\r\n'
export const SHELL_REFUSAL = `\r\n${DIM}demo: commands do not run here — install wherdr to drive your own terminals.${RESET}\r\n`
