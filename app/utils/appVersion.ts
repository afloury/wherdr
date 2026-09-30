// Nouvelle version de l'app après un redéploiement : jamais de rechargement
// forcé pendant l'usage. On compare l'identifiant du build chargé à celui que
// sert le serveur (/_nuxt/builds/latest.json) et on propose un bandeau
// « Recharger ». Seule exception : un morceau de code introuvable (vue pas
// encore chargée, supprimée par le déploiement) ; on recharge alors vers la
// vue demandée, une seule fois (garde en sessionStorage, pas de boucle).
// À ne pas confondre avec l'avis de nouvelle image (server/utils/updates.ts).

const GUARD_KEY = 'wherdr:chunk-reload'
// Un second échec dans ce délai après un rechargement = la nouvelle version
// ne suffit pas : on s'arrête au bandeau.
export const CHUNK_RELOAD_GUARD_MS = 30000

// Vrai si le serveur annonce un autre build que celui qui tourne.
export function isNewBuild(current: string | undefined, latest: unknown): boolean {
  if (!current || !latest || typeof latest !== 'object') return false
  const id = (latest as { id?: unknown }).id
  return typeof id === 'string' && id !== '' && id !== current
}

// Erreur de chargement d'un morceau de code (import dynamique) : formulations
// de Chromium, WebKit et Firefox.
export function isChunkLoadError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : typeof err === 'string' ? err : ''
  return /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Unable to preload CSS/i.test(msg)
}

interface MiniStorage { getItem(k: string): string | null, setItem(k: string, v: string): void }

// Peut-on recharger pour un morceau manquant ? Oui une fois ; non si l'on
// vient déjà de recharger pour ça (boucle). Enregistre la tentative.
export function mayReloadForChunk(storage: MiniStorage | null, now: number): boolean {
  if (!storage) return false
  try {
    const last = Number(storage.getItem(GUARD_KEY) || 0)
    if (last && now - last < CHUNK_RELOAD_GUARD_MS) return false
    storage.setItem(GUARD_KEY, String(now))
    return true
  } catch { return false }
}
