// Étoile animée devant le verbe de Claude (« ✻ Orbiting… »), comme dans Claude
// Code 2.1.x : six glyphes à l'aller puis au retour (12 images, les extrêmes
// doublés), une image toutes les 120 ms. Sous Linux Claude remplace ✳ par « * » ;
// l'app garde toujours la séquence de macOS, indépendamment de l'écran lu.
export const SPINNER_GLYPHS = ['·', '✢', '✳', '✶', '✻', '✽'] as const
export const SPINNER_FRAMES: readonly string[] = [...SPINNER_GLYPHS, ...[...SPINNER_GLYPHS].reverse()]
export const SPINNER_MS = 120
// Glyphe fixe quand le système demande moins d'animations.
export const SPINNER_REST = '✻'

// Image à afficher `elapsed` ms après le début de l'animation.
export function spinnerGlyph(elapsed: number, reduced = false): string {
  if (reduced) return SPINNER_REST
  const i = Math.floor(Math.max(0, elapsed) / SPINNER_MS) % SPINNER_FRAMES.length
  return SPINNER_FRAMES[i]!
}
