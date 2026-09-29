// Avis « nouvelle version de wherdr » (/api/update) : chargé une fois par ouverture
// de l'app (le serveur ne demande à GitHub qu'une fois par jour). « Masquer »
// vaut jusqu'à la version suivante, sur cet appareil.
import type { UpdateInfo } from '#shared/updates'

const DISMISS_KEY = 'wherdr.update.dismissed'
export const updateInfo = ref<UpdateInfo | null>(null)
const dismissed = ref<string>('')
let loaded = false

export function loadUpdate() {
  if (loaded) return
  loaded = true
  try { dismissed.value = localStorage.getItem(DISMISS_KEY) || '' } catch { /* stockage indisponible */ }
  api<UpdateInfo>('/api/update').then((u) => { updateInfo.value = u }).catch(() => { loaded = false })
}

// Nouvelle version à signaler sur l'accueil (masquable).
export const updateBanner = computed(() => {
  const u = updateInfo.value
  return u?.latest && u.latest !== dismissed.value ? u : null
})

export function dismissUpdate() {
  const v = updateInfo.value?.latest
  if (!v) return
  dismissed.value = v
  try { localStorage.setItem(DISMISS_KEY, v) } catch { /* stockage indisponible */ }
}
