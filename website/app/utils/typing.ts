// The app's typewriter + encrypted text timing, copied from
// app/utils/typewriter.ts (the site builds on its own, without the app's
// sources). A root test checks that both give the same fronts and glyphs.
// The app's defaults: speed "medium", encrypted text on.

export const TYPE_MIN_MS = 500
export const TYPE_MAX_MS = 2000
export type TypingSpeed = 'off' | 'fast' | 'medium' | 'slow'
export const TYPE_FACTOR: Record<Exclude<TypingSpeed, 'off'>, number> = { fast: 1, medium: 2, slow: 3 }
export const CIPHER_GAP: Record<Exclude<TypingSpeed, 'off'>, number> = { fast: 20, medium: 40, slow: 70 }
export const CATCHUP_MS: Record<Exclude<TypingSpeed, 'off'>, number> = { fast: 300, medium: 450, slow: 650 }
export const GLYPH_MS = 60
export const TRAIL_GLYPHS = '#%@&$*+=-/\\|<>01{}[]~^:;_!?'
/** A new device's speed in the app. */
export const DEFAULT_SPEED: TypingSpeed = 'medium'

export function typeDuration(chars: number, speed: TypingSpeed = 'fast'): number {
  if (speed === 'off') return 0
  return Math.round(Math.min(TYPE_MAX_MS, Math.max(TYPE_MIN_MS, 400 + chars * 3.5)) * TYPE_FACTOR[speed])
}

export interface TypingFronts { written: number, decrypted: number, done: boolean }
/** Characters written (glyphs) and decrypted (real text) `elapsed` ms into the reveal. */
export function typingFronts(total: number, elapsed: number, speed: TypingSpeed): TypingFronts {
  if (speed === 'off' || total <= 0) return { written: total, decrypted: total, done: true }
  const duration = typeDuration(total, speed)
  const written = Math.min(total, Math.floor(Math.max(0, elapsed) / duration * total))
  const gap = Math.min(total, CIPHER_GAP[speed])
  const behind = Math.max(0, written - gap)
  const catchup = Math.min(1, Math.max(0, elapsed - duration) / CATCHUP_MS[speed])
  const decrypted = Math.min(total, behind + Math.floor((total - behind) * catchup))
  return { written, decrypted, done: elapsed >= duration + CATCHUP_MS[speed] }
}

/** One glyph per character; whitespace stays whitespace. */
export function trailGlyphs(text: string, rand: () => number = Math.random): string[] {
  return Array.from(text, c => (/\s/.test(c) ? c : TRAIL_GLYPHS[Math.floor(rand() * TRAIL_GLYPHS.length)]!))
}
