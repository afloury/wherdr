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
import type { OmpActivity as OmpActivityState, OmpStatus, ShellRun } from '../../shared/types'
import { OMP_ASCII_SPINNER, OMP_ESC, OMP_SPINNER, ompAlt } from '../../shared/ompSymbols'

// A rule: box lines, or dashes with the ascii symbol preset.
const RULE = /^\s*(?:[─━╰][─━╯\s]{9,}\S?|-{10,})\s*$/
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
// The step is the label ("intent") of the running tool; "⎋" (Esc interrupts,
// another glyph per symbol preset, see shared/ompSymbols.ts) or the spinner
// leads it, the session title is right-aligned after a wide gap. Before the
// first tool, omp shows a generic "Working…": no step then. The status line
// (current layout) opens with the spinner and the turn's elapsed time;
// older layouts put the status line under the input field, without a timer.
export interface OmpActivity { step: string | null, elapsed: number | null }

const ESC = ompAlt(OMP_ESC)
const STEP_RE = new RegExp(`^ {0,3}(?:${ESC}|[${OMP_SPINNER}]) +(\\S.*?)(?: {3,}\\S.*)?$`)
// ascii spinner ("- Reading"): only below a status line timer, a markdown bullet otherwise.
const ASCII_STEP_RE = new RegExp(`^ {0,3}[${OMP_ASCII_SPINNER}] +(\\S.*?)(?: {3,}\\S.*)?$`)
const ELAPSED_RE = new RegExp(`^ {0,3}(?:[${OMP_SPINNER}] +((?:\\d+h ?)?(?:\\d+m ?)?\\d+s)(?: +>|$)|[${OMP_ASCII_SPINNER}] +((?:\\d+h ?)?(?:\\d+m ?)?\\d+s) +>)`)
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
      if (elapsed === null) elapsed = seconds(e[1] ?? e[2]!)
      continue
    }
    const m = STEP_RE.exec(line) || (elapsed !== null ? ASCII_STEP_RE.exec(line) : null)
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

// A "!" / "$" command the user runs from omp's input field, on screen
// (omp's own status stays idle, the transcript only gets it at the end):
//
//   ──────────────────────────────────────────
//    $ for i in 1 2 3; do echo $i; sleep 1; done      ("$ " shell, ">>> " Python)
//
//    1
//    2
//    ⠧ Running… (⎋ to cancel)                        (spinner and ⎋ per symbol preset)
//   ──────────────────────────────────────────
//
// Its block opens on a rule, the command (wrapped over several rows when long)
// up to a blank row, then the output omp keeps on screen (its last rows).
// `since`: when first seen, kept by the caller from one reading to the next.
const RUNNING_RE = new RegExp(`^ {0,3}[${OMP_SPINNER}${OMP_ASCII_SPINNER}] +Running(?:…|\\.\\.\\.) \\(${ESC} to cancel\\)$`)
const RUN_HEAD = /^ ?(\$|>>>) (\S.*)$/
const SHELL_LINES = 12

export function parseOmpShell(text: string | null | undefined, now = Date.now()): ShellRun | null {
  if (!text) return null
  const lines = text.split('\n').map(l => l.trimEnd())
  let run = -1
  for (let i = lines.length - 1; i >= Math.max(0, lines.length - 16) && run < 0; i--) if (RUNNING_RE.test(lines[i]!)) run = i
  if (run < 0) return null
  let top = -1
  for (let i = run - 1; i >= 0 && top < 0; i--) if (RULE.test(lines[i]!)) top = i
  if (top < 0) return null
  const head = RUN_HEAD.exec(lines[top + 1] || '')
  if (!head) return null
  let i = top + 2
  let command = head[2]!
  // Wrapped rows are cut at the terminal's width: joined without a space.
  for (; i < run && lines[i]!.trim(); i++) command += lines[i]!.replace(/^ /, '')
  const out = lines.slice(i, run)
  while (out.length && !out[0]!.trim()) out.shift()
  while (out.length && !out[out.length - 1]!.trim()) out.pop()
  const shown = out.map(l => l.replace(/^ /, ''))
  const kept = shown.slice(-SHELL_LINES)
  return { command: command.trim(), lines: kept, hidden: shown.length - kept.length, since: now, ...(head[1] === '>>>' ? { python: true } : {}) }
}
