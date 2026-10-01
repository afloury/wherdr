// Usage gauges read from a command's screen (Claude Code's /usage,
// Codex's /status), to show them as native bars:
//   Claude:  "Current session" / "████   8% used" / "Resets 2pm (…)"
//   Codex :  "5h limit: [████░░░░] 43% left" / "(resets 15:08)"
// `kind` keeps the direction shown by the agent: "used" (Claude) or "left" (Codex).
export interface Meter { label: string, pct: number, kind: 'used' | 'left', reset: string | null }

const BAR = /[█▉▊▋▌▍▎▏░▒▓■□]/
const CLAUDE_PCT = /^\s*[█▉▊▋▌▍▎▏░▒▓\s]*?\s*(\d{1,3})%\s+(used|left)\s*$/
const INLINE = /^\s*(.+?):\s*\[?[█▉▊▋▌▍▎▏░▒▓■□\s]*\]?\s*(\d{1,3})%\s+(used|left)\s*(?:\((?:resets\s+)?(.+?)\))?\s*$/i
const RESET_LINE = /^\s*\(resets\s+(.+?)\)\s*$/i

// Share used (0-100), whatever the direction shown.
export const usedOf = (m: Meter) => (m.kind === 'left' ? 100 - m.pct : m.pct)

export function parseMeters(text: string): { meters: Meter[], rest: string } {
  const lines = text.split('\n')
  const meters: Meter[] = []
  const drop = new Set<number>()
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!
    const m = CLAUDE_PCT.exec(l)
    if (m && BAR.test(l) && i > 0 && lines[i - 1]!.trim() && !BAR.test(lines[i - 1]!)) {
      const next = lines[i + 1] || ''
      const reset = /^\s*Resets?\s+/i.test(next) ? next.trim().replace(/^Resets?\s+/i, '') : null
      meters.push({ label: lines[i - 1]!.trim(), pct: Math.min(100, Number(m[1])), kind: m[2] as 'used' | 'left', reset })
      drop.add(i - 1).add(i)
      if (reset) drop.add(i + 1)
      continue
    }
    const n = INLINE.exec(l)
    if (n && BAR.test(l)) {
      let reset = n[4] ? n[4].trim() : null
      const r = RESET_LINE.exec(lines[i + 1] || '')
      if (!reset && r) { reset = r[1]!.trim(); drop.add(i + 1) }
      meters.push({ label: n[1]!.trim(), pct: Math.min(100, Number(n[2])), kind: n[3]!.toLowerCase() as 'used' | 'left', reset })
      drop.add(i)
    }
  }
  const rest = lines.filter((_, i) => !drop.has(i))
    // Settings panel tabs and keyboard help: not relevant here.
    .filter(l => !/^\s*Settings\s+Status\s+Config\b/.test(l) && !/^\s*Esc to (cancel|close)\s*$/i.test(l))
    .join('\n').replace(/\n{3,}/g, '\n\n').trim()
  return { meters, rest }
}

// Box drawn by the agent (╭─╮ │ … │ ╰─╯, Codex): we keep the content.
export function unbox(lines: string[]): string[] {
  const out: string[] = []
  for (const l of lines) {
    if (/^\s*[╭╰┌└][─━]+[╮╯┐┘]\s*$/.test(l)) continue
    const m = /^\s*[│┃]\s?(.*?)\s*[│┃]\s*$/.exec(l)
    out.push(m ? m[1]! : l)
  }
  return out
}
