// Ligne d'état d'omp, lue au bas de son écran (texte « detection » de Herdr) :
//
//   ──────────────────────────── ◫ 51.7%/1M ⟲ · ⏱ 5h 44% (2h 6m) · 7d 71% ─   jauges
//   ❯ texte en cours de saisie
//   ────────────────────────────────────────────────────────────────────────
//    ◒ Opus 5.5 👁 · 📁 ~/wherdr · ⑂ omp-support *23 ?3                      ligne d'état
//
// La ligne d'état est la dernière ligne de l'écran, juste sous un trait (le
// bas du champ, ou d'une boîte « Ask » ouverte). Les jauges sont incrustées
// dans le trait du haut du champ, quand il est visible.
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
