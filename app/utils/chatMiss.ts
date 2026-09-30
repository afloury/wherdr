// Une conversation déjà affichée ne se vide pas sur un seul sondage raté :
// transcription distante momentanément introuvable, agent absent d'un
// instantané, lecture SSH en échec. On garde la dernière version et on ne
// conclut à la disparition qu'après plusieurs réponses « indisponible » de suite.
export const CHAT_MISS_LIMIT = 3 // trois sondages de suite, quelques secondes
// Au-delà, une petite note « reconnexion » dit que la vue n'est plus à jour.
export const CHAT_STALE_AFTER = 2

export interface ChatMisses { misses: number, errors: number }

export const noMisses = (): ChatMisses => ({ misses: 0, errors: 0 })

// Réponse « indisponible » : faut-il vider la vue maintenant ?
export function onUnavailable(s: ChatMisses, shown: boolean): { next: ChatMisses, clear: boolean } {
  if (!shown) return { next: noMisses(), clear: true }
  const misses = s.misses + 1
  if (misses >= CHAT_MISS_LIMIT) return { next: noMisses(), clear: true }
  return { next: { ...s, misses }, clear: false }
}

export const onError = (s: ChatMisses): ChatMisses => ({ ...s, errors: s.errors + 1 })

// Vue gardée mais plus rafraîchie depuis quelques sondages.
export const isStale = (s: ChatMisses) => s.misses + s.errors >= CHAT_STALE_AFTER
