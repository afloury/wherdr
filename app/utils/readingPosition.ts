// Position de lecture d'une conversation, gardée le temps de la session de
// l'app : revenir des Réglages (ou d'une autre vue) rouvre la conversation au
// même endroit. Mesurée depuis le bas : au retour, seule la fin de la
// conversation est rechargée (les tranches plus anciennes reviennent en
// remontant). En bas de la conversation, on reste collé en bas.

interface ReadingPosition { file: string, fromBottom: number }

const NEAR_END = 120
const MAX_KEPT = 50
const positions = new Map<string, ReadingPosition>()

export function saveReadingPosition(paneId: string, file: string | null, box: { scrollTop: number, scrollHeight: number, clientHeight: number }) {
  positions.delete(paneId)
  if (!file || box.scrollHeight - box.scrollTop - box.clientHeight < NEAR_END) return
  positions.set(paneId, { file, fromBottom: box.scrollHeight - box.scrollTop })
  if (positions.size > MAX_KEPT) positions.delete(positions.keys().next().value!)
}

// Défilement à rétablir, ou null (rien de gardé, autre session : on va en bas).
export function restoredScrollTop(paneId: string, file: string | null, scrollHeight: number): number | null {
  const p = positions.get(paneId)
  if (!p || p.file !== file) return null
  return Math.max(0, scrollHeight - p.fromBottom)
}
