import { settingsRowIndex } from '../../shared/settingsScreen'
import { unbox } from './meters'

// The result on screen: Claude Code's whole settings panel (it replaces the
// command line), or below the command line, or omp's
// last titled box ("╭─ Session Info ─", "╭─ /btw … ─"), otherwise
// the bottom of the screen.
export function extractResult(text: string, cmd: string) {
  const lines = text.replace(/\s+$/, '').split('\n')
  let start = settingsRowIndex(lines)
  for (let i = lines.length - 1; i >= 0 && start < 0; i--) {
    // "❯ /usage" (Claude), or the command alone on its line (Codex).
    if (lines[i]!.includes(cmd) && (/^\s*[❯›>]/.test(lines[i]!) || lines[i]!.trim() === cmd)) start = i + 1
  }
  if (start < 0) start = lines.findLastIndex(l => /^\s*╭─+ \S/.test(l))
  let out = start >= 0 ? lines.slice(start) : lines.slice(-30)
  // Box just below the command (Codex) or omp panel: its content,
  // without what follows, nor its title, separators and shortcuts ("⎋ to close").
  const top = out.findIndex(l => l.trim())
  if (top >= 0 && /^\s*[╭┌]/.test(out[top]!)) {
    const end = out.findIndex((l, i) => i > top && /^\s*[╰└]/.test(l))
    out = unbox(out.slice(top, end > 0 ? end + 1 : undefined).filter(l => !/^\s*[╭├]─+ \S/.test(l)))
      .filter(l => !/⎋/.test(l))
      .map(l => (/^\s*[├┝][─━]+[┤┥]?\s*$/.test(l) ? '' : l))
  }
  const rule = out.findIndex(l => /^[\s─━]{20,}$/.test(l))
  if (rule > 0) out = out.slice(0, rule)
  // Scroll indicators of the panel ("↓", "↑", "↓ stats") at the end of the line.
  out = out.map(l => l.replace(/\s{2,}[↑↓](\s+\w+)?\s*$/, ''))
  // Common indentation of the panel: removed, so that the first line (trimmed
  // below) stays aligned with the others.
  const indent = Math.min(...out.filter(l => l.trim()).map(l => l.match(/^ */)![0].length))
  if (Number.isFinite(indent) && indent > 0) out = out.map(l => l.slice(indent))
  return out.join('\n').replace(/^\s*⎿\s?/m, '').replace(/\n{3,}/g, '\n\n').trim()
}
