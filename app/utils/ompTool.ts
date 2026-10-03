// An omp tool call written the way omp's terminal writes it: wall time
// ("0.71s", "3m24s"), the counts after the target ("95 matches · in server",
// "+3/-2") and the note above a cut output ("… (12 earlier lines)").
import type { OmpToolView } from '../../shared/types'
import { tl } from './i18n'

// "0.03s" under a minute (omp's "Wall: 0.71s"), then "3m24s", "1h3m".
export function ompWall(ms: number): string {
  if (!(ms >= 0)) return ''
  if (ms < 60_000) return `${(ms / 1000).toFixed(2)}s`
  const s = Math.round(ms / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return h ? `${h}h${m}m` : `${m}m${s % 60}s`
}

const plural = (n: number, en: string, ens: string, fr: string, frs: string) => `${n} ${n === 1 ? tl(en, fr) : tl(ens, frs)}`

// What omp prints after the target, as separate pieces.
export function ompToolMeta(v: OmpToolView): string[] {
  const out: string[] = []
  if (typeof v.matches === 'number') {
    out.push(plural(v.matches, 'match', 'matches', 'résultat', 'résultats') + (v.files && v.files > 1 ? ` ${tl(`in ${v.files} files`, `dans ${v.files} fichiers`)}` : ''))
  } else if (typeof v.files === 'number') out.push(plural(v.files, 'file', 'files', 'fichier', 'fichiers'))
  if (v.scope) out.push(`${tl('in', 'dans')} ${v.scope}`)
  if (typeof v.added === 'number' || typeof v.removed === 'number') out.push(`+${v.added || 0}/-${v.removed || 0}`)
  if (v.job) out.push(`${tl('Backgrounded', 'En arrière-plan')}: ${v.job}`)
  if (v.exit) out.push(`Exit: ${v.exit}`)
  return out
}

// Lines of the output not shown above the excerpt (bash keeps the last ones).
export function ompEarlier(v: OmpToolView): number {
  if (!v.out || !v.outLines) return 0
  return Math.max(0, v.outLines - v.out.split('\n').length)
}

// Glyph in front of the title, like omp's status icons.
export const ompToolGlyph = (v: OmpToolView, error: boolean) =>
  error ? '⚠' : v.title === 'Edit' || v.title === 'AST Edit' || v.title === 'Write' ? '✎' : v.title === 'Web Search' ? '⌕' : '●'
