<script setup lang="ts">
// Verrouillage par clé d'accès (WebAuthn, cf. server/utils/auth.ts).
import { startAuthentication } from '@simplewebauthn/browser'

const busy = ref(false)
const error = ref<string | null>(null)

async function unlock() {
  busy.value = true
  error.value = null
  try {
    const opts = await api<Parameters<typeof startAuthentication>[0]['optionsJSON']>('/api/auth/login/options', {})
    const response = await startAuthentication({ optionsJSON: opts })
    await api('/api/auth/login/verify', { response })
    haptic()
    await start()
  } catch (err) {
    const e = err as Error
    error.value = e.name === 'NotAllowedError' ? t('Déverrouillage annulé') : e.message
  } finally { busy.value = false }
}
</script>

<template>
  <div class="lock-screen">
    <div class="lock-box">
      <img :src="'/icons/icon-192.png?v=4'" alt="" class="lock-logo">
      <p class="eyebrow">{{ brandLabel }}</p>
      <h2>{{ t('wherdr est verrouillé') }}</h2>
      <p class="muted">{{ t('Déverrouille avec ta clé d’accès (Face ID, Touch ID, Windows Hello…) pour accéder à tes agents.') }}</p>
      <UButton block size="xl" variant="solid" icon="i-lucide-scan-face" class="lock-btn hw-cta" color="primary" :loading="busy" @click="unlock">
        {{ t('Déverrouiller') }}
      </UButton>
      <p v-if="error" class="form-error">{{ error }}</p>
    </div>
  </div>
</template>
