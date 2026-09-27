// Messages envoyés depuis le téléphone et affichés « en attente » : quand
// l'agent les a-t-il pris ?
import type { ChatItem, QueuedMessage } from '../../shared/types'

export const QUEUED_TTL_MS = 60 * 60 * 1000
// Photo envoyée (ligne « <home>/.cache/herdr-web/uploads/<nom> » d'un message).
export const isUploadLine = (l: string) => l.includes('/.cache/herdr-web/uploads/')
const norm = (t: unknown) => String(t || '').replace(/\s+/g, ' ').trim().toLowerCase()

// Pris par l'agent = un message utilisateur de la transcription, écrit après
// l'envoi, qui contient le début du texte (Claude peut regrouper plusieurs
// messages en attente en un seul tour). Texte modifié par l'agent : au repos,
// un message de l'utilisateur écrit après l'envoi puis une réponse suffisent.
export function queuedDone(q: Required<QueuedMessage>, items: ChatItem[], idle: boolean, now: number): boolean {
  if (now - q.at > QUEUED_TTL_MS) return true
  const users = items.filter(i => i.role === 'user' || i.role === 'cmd')
  // Les chemins de photos deviennent des images dans la transcription.
  const needle = norm(q.text.split('\n').filter(l => !isUploadLine(l)).join(' ')).slice(0, 80)
  if (users.some(u => (!u.ts || Date.parse(u.ts) >= q.at - 10000)
    && (needle ? norm(u.text).includes(needle) : (u.images || 0) > 0))) return true
  if (!idle) return false
  const i = items.findIndex(u => u.role === 'user' && u.ts && Date.parse(u.ts) > q.at)
  return i >= 0 && items.slice(i + 1).some(a => a.role === 'assistant')
}
