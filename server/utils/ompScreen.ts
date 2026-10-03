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
import type { OmpActivity as OmpActivityState, OmpStatus } from '../../shared/types'

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

// omp's activity while it works, read from the same screen:
//
//   ⎋ Sleeping first time                              Run sleep commands     step · session title
//  ⠹ 5s > ◔ Opus 5.5 > 📁 ~/demo > S0.01 ▶─1%──────────────────────────      spinner, elapsed
//
// The step is the label ("intent") of the running tool; "⎋" (Esc interrupts)
// leads it, the session title is right-aligned after a wide gap. Before the
// first tool, omp shows a generic "Working…": no step then. The status line
// (current layout) opens with the braille spinner and the turn's elapsed time;
// older layouts put the status line under the input field, without a timer.
export interface OmpActivity { step: string | null, elapsed: number | null }

const BRAILLE = '⠁-⣿'
const STEP_RE = new RegExp(`^ {0,3}[⎋${BRAILLE}] +(\\S.*?)(?: {3,}\\S.*)?$`)
const ELAPSED_RE = new RegExp(`^ {0,3}[${BRAILLE}] +((?:\\d+h ?)?(?:\\d+m ?)?\\d+s)(?: +>|$)`)
const GENERIC = /^(?:Working|Thinking)(?:…|\.\.\.)?$/i

// "1h 2m 5s" → seconds.
function seconds(s: string): number {
  let n = 0
  for (const m of s.matchAll(/(\d+)([hms])/g)) n += Number(m[1]) * (m[2] === 'h' ? 3600 : m[2] === 'm' ? 60 : 1)
  return n
}

export function parseOmpActivity(text: string | null | undefined): OmpActivity | null {
  if (!text) return null
  const lines = text.split('\n').map(l => l.trimEnd())
  let step: string | null = null
  let elapsed: number | null = null
  let found = false
  // The activity sits in the screen's last few lines (below it: the status
  // line and the input field, a few lines at most even when it grows).
  for (let i = lines.length - 1; i >= Math.max(0, lines.length - 16); i--) {
    const line = lines[i]!
    const e = ELAPSED_RE.exec(line)
    if (e) {
      if (elapsed === null) elapsed = seconds(e[1]!)
      continue
    }
    const m = STEP_RE.exec(line)
    if (m) {
      const label = m[1]!.trim()
      step = GENERIC.test(label) ? null : label.slice(0, 120)
      found = true
      break
    }
  }
  return found || elapsed !== null ? { step, elapsed } : null
}

// Elapsed seconds on screen → start of the turn, stable within a few seconds.
export function ompActivityOf(a: OmpActivity | null, prev: OmpActivityState | null, now = Date.now()): OmpActivityState | null {
  if (!a) return null
  let since = a.elapsed === null ? null : now - a.elapsed * 1000
  if (since !== null && prev?.since != null && Math.abs(since - prev.since) < 3000) since = prev.since
  return { step: a.step, since }
}
