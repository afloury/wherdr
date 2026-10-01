// Animated star in front of Claude's verb ("✻ Orbiting…"), as in Claude
// Code 2.1.x: six glyphs forward then back (12 frames, the extremes
// doubled), one frame every 120 ms. On Linux Claude replaces ✳ with "*";
// the app always keeps the macOS sequence, regardless of the screen read.
export const SPINNER_GLYPHS = ['·', '✢', '✳', '✶', '✻', '✽'] as const
export const SPINNER_FRAMES: readonly string[] = [...SPINNER_GLYPHS, ...[...SPINNER_GLYPHS].reverse()]
export const SPINNER_MS = 120
// Fixed glyph when the system asks for reduced motion.
export const SPINNER_REST = '✻'

// Frame to show `elapsed` ms after the start of the animation.
export function spinnerGlyph(elapsed: number, reduced = false): string {
  if (reduced) return SPINNER_REST
  const i = Math.floor(Math.max(0, elapsed) / SPINNER_MS) % SPINNER_FRAMES.length
  return SPINNER_FRAMES[i]!
}
