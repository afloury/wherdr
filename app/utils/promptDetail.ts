// Demande de permission : résumé en une ligne pour les cartes (accueil, plan),
// et découpage du diff pour la vue de l'agent.
import type { PromptDetail } from '#shared/types'

export function detailStats(d: PromptDetail): string {
  return [d.added ? `+${d.added}` : '', d.removed ? `−${d.removed}` : ''].filter(Boolean).join(' ')
}

// « $ npm test », « app/foo.ts +3 −1 », ou le nom de l'outil.
export function detailLine(d: PromptDetail | null | undefined): string {
  if (!d) return ''
  // Le nom du fichier compte plus que son dossier (la carte coupe à droite).
  if (d.file) return [d.file.split(', ').map(f => f.split('/').pop()).join(', '), detailStats(d)].filter(Boolean).join('  ')
  // Lignes continuées par « \ » : une seule ligne.
  const first = (d.command || '').replace(/\s*\\\n\s*/g, ' ').split('\n').find(l => l.trim())
  if (first) return `$ ${first.trim()}`
  return d.description || d.tool
}

export type DetailLineKind = 'add' | 'del' | null
// Ligne d'un diff (« + x », « 12 + x », « - y ») : ajout, retrait ou contexte.
export function diffKind(line: string, isFile: boolean): DetailLineKind {
  if (!isFile) return null
  if (/^(?:\s*\d+\s*)?\+/.test(line) && !/^\+\+\+/.test(line)) return 'add'
  if (/^(?:\s*\d+\s*)?-/.test(line) && !/^---/.test(line)) return 'del'
  return null
}
