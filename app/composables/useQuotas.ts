// Home quotas (/api/quotas): loaded by HomeView every minute
// when shown and the page is visible, kept offline; read by the top tables
// and the machine ones (QuotaStrip) and by the install banners.
import type { Quotas } from '#shared/types'
import { readOffline, saveQuotas } from '~/utils/offlineCache'
import { mayReadOffline, readOfflineAccess } from '~/utils/offlineAccess'

export const quotaNow = ref(Date.now())

export async function reloadQuotas() {
  try {
    const q = await api<Quotas>('/api/quotas')
    homeQuotas.value = q
    if (mayReadOffline(readOfflineAccess())) saveQuotas(q)
  }
  catch { /* retry on the next round */ }
  quotaNow.value = Date.now()
}

export function useQuotaLoader() {
  let timer: ReturnType<typeof setInterval> | null = null
  onMounted(() => {
    if (mayReadOffline(readOfflineAccess())) readOffline().then(s => { if (!homeQuotas.value) homeQuotas.value = s.home?.quotas || null })
    if (showQuotas.value) reloadQuotas()
    timer = setInterval(() => { if (pageVisible.value && showQuotas.value) reloadQuotas() }, 60000)
  })
  onUnmounted(() => { if (timer) clearInterval(timer) })
  watch([pageVisible, showQuotas], ([v, on]) => { if (v && on) reloadQuotas() })
}
