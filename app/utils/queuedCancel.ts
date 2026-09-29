// Bouton « Annuler » des messages en attente : quand l'afficher, et comment
// remettre le message dans le champ de saisie (texte + photos jointes).
import type { Pane } from '../../shared/types'
import type { DraftAtt } from '../composables/useDraft'
import { parseReply, type ReplyTarget } from '../../shared/replyQuote'

const UPLOAD = '/.cache/herdr-web/uploads/'

// Pas encore parti (agent qui démarre) : toujours. Sinon seulement chez Claude
// au travail : sa file se rappelle par ↑ ; celle de Codex n'a pas de rappel
// vérifié. Hors travail, le message est déjà lu (ou sur le point de l'être).
export function canCancelQueued(p: Pane | undefined): boolean {
  if (!p || !p.agent) return false
  return Boolean(p.pendingPrompt) || (p.agent === 'claude' && p.status === 'working')
}

// Remet un message annulé dans le brouillon, comme s'il n'avait jamais été
// envoyé : son texte avant ce qui était déjà tapé, ses photos jointes.
export function restoreDraft(draft: { text: string, atts: DraftAtt[], reply?: ReplyTarget | null }, message: string) {
  // Réponse à un message précis : le repère redevient l'encadré « En réponse à ».
  const parsed = parseReply(message)
  if (parsed && 'reply' in draft) {
    draft.reply = parsed.reply
    message = parsed.body
  }
  const lines = String(message || '').split('\n')
  const photos = lines.filter(l => l.includes(UPLOAD)).map(l => l.trim())
  const text = lines.filter(l => !l.includes(UPLOAD)).join('\n').trim()
  draft.text = [text, draft.text.trim()].filter(Boolean).join('\n')
  for (const path of photos) {
    if (draft.atts.some(a => a.path === path)) continue
    const name = path.split('/').pop()!
    draft.atts.push({ url: `/uploads/${encodeURIComponent(name)}`, path, name })
  }
}
