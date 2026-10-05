// Frames of the "encrypted text" effect: same glyph set as the app's cipher
// trail (app/utils/typewriter.ts TRAIL_GLYPHS).
export const GLYPHS = '#%@&$*+=-/\\|<>01{}[]~^:;_!?'

// Frame at progress p (0 → 1): characters before the front are decrypted,
// the rest are random glyphs. Spaces stay spaces so the words keep their shape.
export function scrambleFrame(text: string, p: number, rand: () => number): string {
  const front = Math.floor(Math.max(0, Math.min(1, p)) * text.length)
  let out = text.slice(0, front)
  for (let i = front; i < text.length; i++) {
    const c = text[i]!
    out += c === ' ' ? ' ' : GLYPHS[Math.floor(rand() * GLYPHS.length)]
  }
  return out
}
