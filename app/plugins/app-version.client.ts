// Nouvelle version après un déploiement (remplace les rechargements
// automatiques de Nuxt, coupés dans nuxt.config.ts) : vérification toutes les
// 5 min, au retour sur la page et à chaque reconnexion au serveur ; morceau de code manquant pendant une
// navigation → un seul rechargement vers la vue demandée, sinon le bandeau.
import { isChunkLoadError, mayReloadForChunk } from '../utils/appVersion'

const CHECK_EVERY_MS = 5 * 60000

export default defineNuxtPlugin((nuxtApp) => {
  const router = useRouter()
  const chunkErrors = new Set<unknown>()
  router.beforeEach(() => { chunkErrors.clear() })
  nuxtApp.hook('app:chunkError', ({ error }) => { chunkErrors.add(error) })
  router.onError((error, to) => {
    if (!chunkErrors.has(error) && !isChunkLoadError(error)) return
    let storage: Storage | null = null
    try { storage = sessionStorage } catch { /* indisponible */ }
    if (mayReloadForChunk(storage, Date.now())) applyNewVersion('#' + to.fullPath)
    else newVersionReady.value = true
  })

  setInterval(() => { if (!document.hidden) checkNewVersion() }, CHECK_EVERY_MS)
  document.addEventListener('visibilitychange', () => { if (!document.hidden) checkNewVersion() })
})
