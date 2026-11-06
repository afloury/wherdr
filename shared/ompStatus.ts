// omp's status line and context gauge, read from its screen (pure, server and client).
//
// omp 18 draws the status line just above the bottom of its input box, the context
// gauge at its end (unicode, Nerd Font or ascii symbols; the window size after it):
//
//    ⠸ 4s > ⬢ Model > 🗑 ~/demo > ⑂ main ?1 ▶────6%──────────╎───┃─────128K─
//   ╰─
//
// Some layouts put both in the box's top border instead:
//
//   ╭── ⠦ 4m > ◒ GPT > 📁 ~/project ▶──27%────┃──500K─◀ ⚙ 1 ──╮
//   │ text being typed                                          │
//   ╰───────────────────────────────────────────────────────────╯
//
// Older omp puts the status line last, below a rule, and the gauges in the field's top rule:
//
//   ──────────────── ◫ 51.7%/1M ⟲ · ⏱ 5h 44% (2h 6m) · 7d 71% ─
//   ❯ text being typed
//   ──────────────────────────────────────────────────────────
//    ◒ Opus 5.5 👁 · 📁 ~/wherdr · ⑂ omp-support *24 ?4
import type { OmpStatus } from './types'

// A rule: box lines, or dashes with the ascii symbol preset.
const RULE = /^\s*(?:[─━╰][─━╯\s]{9,}\S?|-{10,})\s*$/
const METERS = /^\s*[─━]{3,} (.+?) [─━]+\s*$/
// Gauge filler: rules, separators and the Nerd Font marks between the figures.
const SEP = '[─━│┃╎┆┊:|\\s\\u{f055d}\\u{f0068}-]'
const NUM = '\\d+(?:\\.\\d+)?'
// A gauge ending the status line, opened by ▶, the powerline arrow or ">" (ascii).
const TAIL_GAUGE = new RegExp(`[▶>\\u{e0b0}](${SEP}*(?:${NUM}%${SEP}*${NUM}[kKmM]?|${NUM}[kKmM]?${SEP}+${NUM}%)${SEP}*)◀?\\s*$`, 'u')

export function parseOmpStatus(text: string | null | undefined): OmpStatus | null {
  if (!text) return null
  const lines = text.split('\n').map(l => l.trimEnd()).filter(Boolean)
  const status = lines[lines.length - 1]
  const below = lines[lines.length - 2]
  if (status && /^\s*╰[─━]/.test(status)) {
    // Only the box's own border: gauges in older output above it are history.
    const border = lines.slice(-16, -1).findLast(l => /^\s*╭[─━]/.test(l) && l.includes('▶'))
    if (border) {
      const meters = /▶[^◀\n]*◀/.exec(border)?.[0] ?? null
      const line = border.replace(/^\s*╭[─━]+\s*/, '').replace(/▶[^◀\n]*◀/, ' ').replace(/\s*[─━]*╮\s*$/, '').trim().slice(0, 300)
      return { line, meters }
    }
    if (below && !/^\s*[─━│╭╰├┌└]/.test(below)) {
      const gauge = TAIL_GAUGE.exec(below)
      // Kept as ▶…◀, the form parseOmpContext reads.
      const meters = gauge ? `▶${gauge[1]!.trim()}◀` : null
      const line = (gauge ? below.slice(0, gauge.index) : below).replace(/[\s─━-]+$/, '').trim().slice(0, 300)
      return { line, meters: meters && meters.slice(0, 200) }
    }
  }
  if (!status || !below || !RULE.test(below) || /^\s*[─━│╭╰├┌└]/.test(status)) return null
  let meters: string | null = null
  for (let i = lines.length - 3; i >= Math.max(0, lines.length - 15) && meters === null; i--) {
    const m = METERS.exec(lines[i]!)
    if (m) meters = m[1]!.trim()
  }
  return { line: status.trim().slice(0, 300), meters: meters && meters.slice(0, 200) }
}

const CONTEXT = /◫\s*(\d+(?:\.\d+)?)%\s*\/\s*(\d+(?:\.\d+)?)\s*([kKmM])?\b/
const BORDER_CONTEXT = new RegExp(`^▶${SEP}*(\\d+(?:\\.\\d+)?)%${SEP}*(\\d+(?:\\.\\d+)?)([kKmM])?${SEP}*◀$`, 'u')
// Above the window (after switching to a smaller model), omp writes the window first.
const OVERFLOW_CONTEXT = new RegExp(`^▶${SEP}*(\\d+(?:\\.\\d+)?)([kKmM])?${SEP}+(\\d+(?:\\.\\d+)?)%${SEP}*◀$`, 'u')

export interface OmpContext { pct: number, total: number, estimated: number }

// omp's gauge shows a rounded percentage of the window, not a token count.
export function parseOmpContext(text: string | null | undefined): OmpContext | null {
  const trimmed = text?.trim() || ''
  const match = CONTEXT.exec(text || '') || BORDER_CONTEXT.exec(trimmed)
  const overflow = match ? null : OVERFLOW_CONTEXT.exec(trimmed)
  if (!match && !overflow) return null
  const pct = Number(match?.[1] ?? overflow?.[3])
  const unit = (match?.[3] ?? overflow?.[2])?.toUpperCase()
  const total = Number(match?.[2] ?? overflow?.[1]) * (unit === 'M' ? 1_000_000 : unit === 'K' ? 1_000 : 1)
  if (!Number.isFinite(pct) || !Number.isFinite(total) || total <= 0) return null
  return { pct, total, estimated: total * pct / 100 }
}
