<script setup lang="ts">
// Passkey lock (WebAuthn, see server/utils/auth.ts). With `lockSetup`, no
// passkey exists yet and wherdr cannot verify where this connection comes
// from (Tailscale Funnel, or Docker's gateway: server/utils/network.ts): the
// first passkey is set up here, with the bootstrap token from the server logs.
import { startAuthentication, startRegistration } from '@simplewebauthn/browser'

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
    error.value = e.name === 'NotAllowedError' ? t('Unlock cancelled') : e.message
  } finally { busy.value = false }
}

async function setUp() {
  const bootstrapToken = window.prompt(tl('Bootstrap token (in server logs)', 'Jeton d’amorçage (dans les journaux du serveur)'))
  if (!bootstrapToken) return
  busy.value = true
  error.value = null
  try {
    const opts = await api<Parameters<typeof startRegistration>[0]['optionsJSON']>('/api/auth/register/options', { bootstrapToken })
    const response = await startRegistration({ optionsJSON: opts })
    await api('/api/auth/register/verify', { response, name: deviceName(), bootstrapToken })
    haptic()
    await start()
  } catch (err) {
    const e = err as Error
    error.value = e.name === 'NotAllowedError' ? t('Registration cancelled') : e.message
  } finally { busy.value = false }
}

const why = computed(() => lockSetup.value === 'docker'
  ? tl('Docker hides where connections to wherdr come from, so a device on another network could look like this computer. Publish wherdr on 127.0.0.1 only and set WHERDR_DOCKER_LOOPBACK_ONLY=1 (as the shipped docker-compose.yml does), or set up a passkey.', 'Docker masque la provenance des connexions à wherdr : un appareil d’un autre réseau pourrait passer pour cet ordinateur. Publie wherdr sur 127.0.0.1 seulement avec WHERDR_DOCKER_LOOPBACK_ONLY=1 (comme le docker-compose.yml livré), ou configure une passkey.')
  : tl('wherdr cannot confirm that Tailscale Funnel does not expose it to the Internet (Funnel is on, or Tailscale’s state cannot be read). Turn Funnel off for wherdr’s port, or set up a passkey.', 'wherdr ne peut pas confirmer que Tailscale Funnel ne l’expose pas à Internet (Funnel est actif, ou l’état de Tailscale est illisible). Coupe Funnel pour le port de wherdr, ou configure une passkey.'))
</script>

<template>
  <div class="lock-screen">
    <div v-if="lockSetup" class="lock-box">
      <img :src="'/icons/icon-192.png?v=5'" alt="" class="lock-logo">
      <p class="eyebrow">{{ brandLabel }}</p>
      <h2>{{ tl('A passkey is needed here', 'Une passkey est nécessaire ici') }}</h2>
      <p class="muted">{{ why }}</p>
      <p class="muted">{{ tl('The first passkey asks for the bootstrap token printed in the server logs.', 'La première passkey demande le jeton d’amorçage écrit dans les journaux du serveur.') }}</p>
      <UButton block size="xl" variant="solid" icon="i-lucide-lock" class="lock-btn hw-cta" color="primary" :loading="busy" @click="setUp">
        {{ tl('Set up a passkey', 'Configurer une passkey') }}
      </UButton>
      <p v-if="error" class="form-error">{{ error }}</p>
    </div>
    <div v-else class="lock-box">
      <img :src="'/icons/icon-192.png?v=5'" alt="" class="lock-logo">
      <p class="eyebrow">{{ brandLabel }}</p>
      <h2>{{ t('wherdr is locked') }}</h2>
      <p class="muted">{{ t('Unlock with your passkey (Face ID, Touch ID, Windows Hello…) to reach your agents.') }}</p>
      <UButton block size="xl" variant="solid" icon="i-lucide-scan-face" class="lock-btn hw-cta" color="primary" :loading="busy" @click="unlock">
        {{ t('Unlock') }}
      </UButton>
      <p v-if="error" class="form-error">{{ error }}</p>
    </div>
  </div>
</template>
