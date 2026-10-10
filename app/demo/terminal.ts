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

// Markdown the terminal does not draw: bold and code marks.
const strip = (s: string) => s.replace(/\*\*|`/g, '')
const isRow = (l: string) => /^\s*\|.*\|\s*$/.test(l)
const isRule = (l: string) => /^\s*\|(\s*:?-+:?\s*\|)+\s*$/.test(l)
const cells = (row: string) => row.trim().replace(/^\||\|$/g, '').split('|').map(c => strip(c.trim()))

// A Markdown table the way Claude Code draws it: a grid of box characters,
// header in bold, the widest columns narrowed and wrapped to fit the width.
function tableLines(rows: string[][], width: number): string[] {
  const n = Math.max(...rows.map(r => r.length))
  const widths = Array.from({ length: n }, (_, c) => Math.max(1, ...rows.map(r => (r[c] || '').length)))
  // Around the cells: "│ " … " │ " … " │".
  const room = width - (3 * n + 1)
  while (widths.reduce((a, b) => a + b, 0) > room && Math.max(...widths) > 3) widths[widths.indexOf(Math.max(...widths))]!--
  const rule = (l: string, m: string, r: string) => `${DIM}${l}${widths.map(w => '─'.repeat(w + 2)).join(m)}${r}${RESET}`
  const bar = `${DIM}│${RESET}`
  const out = [rule('┌', '┬', '┐')]
  rows.forEach((row, i) => {
    const wrapped = widths.map((w, c) => wrap(row[c] || '', w))
    const height = Math.max(...wrapped.map(x => x.length))
    for (let k = 0; k < height; k++) {
      out.push(`${bar} ${widths.map((w, c) => `${i ? '' : BOLD}${(wrapped[c]![k] || '').padEnd(w)}${i ? '' : RESET}`).join(` ${bar} `)} ${bar}`)
    }
    if (i < rows.length - 1) out.push(rule('├', '┼', '┤'))
  })
  return [...out, rule('└', '┴', '┘')]
}

function assistantLines(text: string, width: number): string[] {
  const src = text.split('\n')
  const out: string[] = []
  for (let i = 0; i < src.length; i++) {
    if (!isRow(src[i]!) || !isRule(src[i + 1] || '')) {
      out.push(...wrap(strip(src[i]!), width))
      continue
    }
    const rows = [cells(src[i]!)]
    for (i += 2; i < src.length && isRow(src[i]!); i++) rows.push(cells(src[i]!))
    i--
    out.push(...tableLines(rows, width))
  }
  return out
}

function itemLines(it: ChatItem, width: number): string[] {
  const w = Math.max(20, width - 4)
  switch (it.role) {
    case 'user': return ['', ...wrap(it.text, w).map((l, i) => `${DIM}${i ? '  ' : '> '}${RESET}${BOLD}${l}${RESET}`)]
    case 'assistant': return ['', ...assistantLines(it.text, w).map((l, i) => `${i ? '  ' : `${ACCENT}⏺${RESET} `}${l}`)]
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
