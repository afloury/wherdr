// First-launch setup guide: shown until finished or skipped, a state kept by
// the server (/api/onboarding) so other devices do not show it again.
// Reopened from Settings › About, or by the Herdr plugin's first install (#/setup).

export const onboardingOpen = ref(false)

export async function checkOnboarding() {
  try {
    const s = await api<{ done: boolean }>('/api/onboarding')
    if (!s.done) onboardingOpen.value = true
  } catch { /* locked or offline: checked again after unlocking */ }
}

// #/setup?step=…: the step the guide opens at (a link from another address).
export const onboardingStep = ref<unknown>(null)

export function openOnboarding(step: unknown = null) {
  onboardingStep.value = step
  onboardingOpen.value = true
}

export async function finishOnboarding() {
  onboardingOpen.value = false
  try { await api('/api/onboarding', { done: true }) }
  catch (err) { toast((err as Error).message, true) }
}
