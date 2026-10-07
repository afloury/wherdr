// Passkey lock state (/api/auth/status), shared by Settings › Security and the
// onboarding's security step.
import type { AuthStatus } from '#shared/types'

export const authStatus = ref<AuthStatus | null>(null)

export async function refreshAuthStatus() {
  try { authStatus.value = await api<AuthStatus>('/api/auth/status') }
  catch { /* offline */ }
}
