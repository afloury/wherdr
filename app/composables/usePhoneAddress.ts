// The phone address (tailnet) as last reported by /api/phone, shared by the
// setup guide, Settings › Phone and the passkey card: on localhost, they offer
// to continue on that address once it answers (utils/onboarding.ts).
import type { PhoneStatus } from '#shared/phone'
import { isLoopbackHost, tailnetSwitch } from '~/utils/onboarding'

export const phoneAddress = ref<PhoneStatus | null>(null)

// Asked on localhost only: elsewhere there is nothing to switch to.
export async function refreshPhoneAddress() {
  if (!import.meta.client || !isLoopbackHost(location.hostname)) return
  try { phoneAddress.value = await api<PhoneStatus>('/api/phone') } catch { /* locked or offline */ }
}

export const tailnet = computed(() => import.meta.client ? tailnetSwitch(location.hostname, phoneAddress.value) : null)
