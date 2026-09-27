// Verrouillage : tout ce qui touche aux agents (API, images, photos) exige une
// session déverrouillée dès qu'une clé d'accès est enregistrée. Les fichiers de
// l'app restent servis pour pouvoir afficher l'écran de verrouillage.
// (Les WebSockets font la même vérification dans leur `upgrade`.)
import { hostAllowed } from '../utils/hosts'
const needsUnlock = (p: string) => (p.startsWith('/api/') && !p.startsWith('/api/auth/')) || p.startsWith('/uploads/')

export default defineEventHandler((event) => {
  if (!hostAllowed(event.node.req.headers.host)) {
    return sendError(event, 403, { error: 'hôte refusé', code: 'host' })
  }
  const path = event.path.split('?')[0]!
  if (needsUnlock(path) && !auth.isUnlocked(reqOf(event))) {
    return sendError(event, 401, { error: 'app verrouillée', code: 'locked' })
  }
})
