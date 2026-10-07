<script setup lang="ts">
// Passkey lock card: enable it, or (once on) add a device, lock, turn off.
// Settings › Security and the onboarding's security step.
import { startRegistration } from '@simplewebauthn/browser'

const sec = authStatus
const supported = import.meta.client && Boolean(window.PublicKeyCredential)

// Readable device name, for the key list.
function deviceName() {
  const ua = navigator.userAgent
  if (/iPhone/.test(ua)) return 'iPhone'
  if (/iPad/.test(ua) || (isIOS && !/iPhone/.test(ua))) return 'iPad'
  if (/Macintosh/.test(ua)) return 'Mac'
  if (/Windows/.test(ua)) return 'Windows'
  if (/Android/.test(ua)) return 'Android'
  return t('Device')
}
async function registerKey() {
  try {
    const bootstrapToken = sec.value?.enabled ? undefined : window.prompt(tl(
      'Bootstrap token (in server logs)',
      'Jeton d’amorçage (dans les journaux du serveur)',
    ))
    if (!sec.value?.enabled && !bootstrapToken) return
    const opts = await api<Parameters<typeof startRegistration>[0]['optionsJSON']>('/api/auth/register/options', { bootstrapToken })
    const response = await startRegistration({ optionsJSON: opts })
    await api('/api/auth/register/verify', { response, name: deviceName(), bootstrapToken })
    await start()
    toast(t('Lock enabled on this device ✓'))
  } catch (err) {
    const e = err as Error
    toast(e.name === 'NotAllowedError'
      ? t('Registration cancelled')
      : e.name === 'InvalidStateError' ? t('This device is already registered') : e.message, true)
  }
  refreshAuthStatus()
}
async function lockNow() {
  await api('/api/auth/lock', {}).catch(() => {})
  showLock()
}
async function lockAllDevices() {
  if (!(await askConfirm(t('Lock every device? Each one, this one included, will need its passkey again. The keys are kept.'), t('Lock all')))) return
  try {
    await api('/api/auth/lock-all', {})
    showLock()
  } catch (err) { toast((err as Error).message, true) }
}
async function disableLock() {
  if (!(await askConfirm(t('Turn off the lock? The app will be open again to anyone who can reach this server.'), t('Turn off')))) return
  try {
    await api('/api/auth/disable', {})
    clearOffline()
    await start()
    toast(t('Lock turned off'))
  } catch (err) { toast((err as Error).message, true) }
  refreshAuthStatus()
}
onMounted(refreshAuthStatus)
</script>

<template>
  <div class="settings-card">
    <template v-if="sec && !sec.enabled">
      <button type="button" class="settings-action" :disabled="!supported" @click="registerKey">
        <UIcon name="i-lucide-lock" />{{ t('Enable passkey lock') }}
      </button>
      <p class="muted">{{ t(supported ? 'Without a lock, anyone who can reach this server can control your agents. Passkey: Face ID, Touch ID, Windows Hello…' : 'This browser does not support passkeys.') }}</p>
    </template>
    <template v-else-if="sec">
      <p class="muted keys">{{ t('Registered keys:') }} {{ sec.devices.map(d => d.name).join(', ') }}</p>
      <button type="button" class="settings-action" @click="registerKey"><UIcon name="i-lucide-plus" />{{ t('Add this device') }}</button>
      <button type="button" class="settings-action" @click="lockNow"><UIcon name="i-lucide-lock" />{{ t('Lock now') }}</button>
      <button type="button" class="settings-action danger" @click="lockAllDevices"><UIcon name="i-lucide-shield-alert" />{{ t('Lock all devices') }}</button>
      <button type="button" class="settings-action danger" @click="disableLock"><UIcon name="i-lucide-lock-open" />{{ t('Turn off lock') }}</button>
      <p class="muted">{{ hostLabel ? tl(`The app locks after 12 h without use. Lost or stolen device: Lock all devices. Lost key: delete data/auth.json on ${hostLabel}.`, `L’app se verrouille après 12 h sans utilisation. Appareil perdu ou volé : Verrouiller tous les appareils. Clé perdue : supprimer data/auth.json sur ${hostLabel}.`) : tl('The app locks after 12 h without use. Lost or stolen device: Lock all devices. Lost key: delete data/auth.json on the server.', 'L’app se verrouille après 12 h sans utilisation. Appareil perdu ou volé : Verrouiller tous les appareils. Clé perdue : supprimer data/auth.json sur le serveur.') }}</p>
    </template>
  </div>
</template>
