// omp's braille spinner in front of its running step ("⠧ Finding Fixed
// section"), as in its status line: ten frames, one every 80 ms. A fixed
// glyph when the system asks for reduced motion.
export const OMP_SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'] as const
export const OMP_SPINNER_MS = 80
export const OMP_SPINNER_REST = '⠿'

// Frame to show `elapsed` ms after the start of the animation.
export function ompSpinnerGlyph(elapsed: number, reduced = false): string {
  if (reduced) return OMP_SPINNER_REST
  const i = Math.floor(Math.max(0, elapsed) / OMP_SPINNER_MS) % OMP_SPINNER_FRAMES.length
  return OMP_SPINNER_FRAMES[i]!
}

// Time since the start of the turn, written like omp: "47s", "2m 5s", "1h 3m".
export function ompElapsed(since: number, now: number): string {
  const s = Math.max(0, Math.floor((now - since) / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (h) return `${h}h ${m}m`
  if (m) return `${m}m ${s % 60}s`
  return `${s}s`
}
