// Nouvelle version de l'app (redéploiement) : état du bandeau « Recharger »,
// service worker en attente, vérification périodique du build servi.
// Logique pure et garde anti-boucle : app/utils/appVersion.ts.
import { isNewBuild } from '../utils/appVersion'

export const newVersionReady = ref(false)
export const newVersionDismissed = ref(false)
let swReg: ServiceWorkerRegistration | null = null
let applying = false

function markNew() {
  newVersionReady.value = true
}

// Service worker : un nouveau SW reste « en attente » (plus de skipWaiting
// automatique) jusqu'au clic sur Recharger.
export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return
  navigator.serviceWorker.register('/sw.js').then((reg) => {
    swReg = reg
    // Un SW en attente au démarrage : la page vient d'être chargée depuis le
    // réseau, on peut l'activer sans rien interrompre (il ne recharge rien).
    reg.waiting?.postMessage({ type: 'skip-waiting' })
    reg.addEventListener('updatefound', () => {
      const sw = reg.installing
      sw?.addEventListener('statechange', () => {
        // Sans contrôleur, c'est la première installation, pas une mise à jour.
        if (sw.state === 'installed' && navigator.serviceWorker.controller) markNew()
      })
    })
  }).catch(() => {})
}

// Le serveur sert-il un autre build que celui qui tourne ?
export async function checkNewVersion() {
  if (newVersionReady.value) return
  try {
    const res = await fetch(`/_nuxt/builds/latest.json?${Date.now()}`, { cache: 'no-store' })
    if (res.ok && isNewBuild(useRuntimeConfig().app.buildId, await res.json())) markNew()
  } catch { /* serveur injoignable : on réessaiera */ }
  try { await swReg?.update() } catch { /* idem */ }
}

// Active le nouveau SW s'il attend, puis recharge (à l'adresse `hash` si donnée).
// Les brouillons sont déjà dans localStorage (useDraft).
export async function applyNewVersion(hash?: string) {
  if (applying) return
  applying = true
  // Nouveau SW encore en cours d'installation : on attend qu'il soit prêt.
  const installing = swReg?.installing
  if (installing) {
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 5000)
      installing.addEventListener('statechange', () => { if (installing.state !== 'installing') { clearTimeout(timer); resolve() } })
    })
  }
  const waiting = swReg?.waiting
  if (waiting && 'serviceWorker' in navigator) {
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 3000)
      navigator.serviceWorker.addEventListener('controllerchange', () => { clearTimeout(timer); resolve() }, { once: true })
      waiting.postMessage({ type: 'skip-waiting' })
    })
  }
  if (hash !== undefined && location.hash !== hash) location.replace(location.pathname + location.search + hash)
  location.reload()
}
