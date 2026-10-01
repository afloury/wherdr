// omp's status line, read at the bottom of its screen (Herdr's "detection" text):
//
//   ──────────────────────────── ◫ 51.7%/1M ⟲ · ⏱ 5h 44% (2h 6m) · 7d 71% ─   gauges
//   ❯ text being typed
//   ────────────────────────────────────────────────────────────────────────
//    ◒ Opus 5.5 👁 · 📁 ~/wherdr · ⑂ omp-support *23 ?3                      status line
//
// The status line is the last line of the screen, just below a rule (the
// bottom of the field, or of an open "Ask" box). The gauges are embedded
// in the top rule of the field, when it is visible.
import type { OmpStatus } from '../../shared/types'

const RULE = /^\s*[─━╰][─━╯\s]{9,}\S?\s*$/
const METERS = /^\s*[─━]{3,} (.+?) [─━]+\s*$/

export function parseOmpStatus(text: string | null | undefined): OmpStatus | null {
  if (!text) return null
  const lines = text.split('\n').map(l => l.trimEnd()).filter(Boolean)
  const status = lines[lines.length - 1]
  const below = lines[lines.length - 2]
  if (!status || !below || !RULE.test(below) || /^\s*[─━│╭╰├┌└]/.test(status)) return null
  let meters: string | null = null
  for (let i = lines.length - 3; i >= Math.max(0, lines.length - 15) && meters === null; i--) {
    const m = METERS.exec(lines[i]!)
    if (m) meters = m[1]!.trim()
  }
  return { line: status.trim().slice(0, 300), meters: meters && meters.slice(0, 200) }
}
