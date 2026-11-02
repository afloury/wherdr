<script setup lang="ts">
const pending = ref(false)
const needsUnlock = ref(false)
const status = ref<{ ok: boolean; version?: string; error?: string; hint?: string }>()
async function check() {
  pending.value = true
  needsUnlock.value = false
  try {
    const response = await fetch('/api/core', { cache: 'no-store' })
    const body = await response.json()
    needsUnlock.value = response.status === 401
    status.value = response.status === 401 ? { ok: false, error: 'App is locked' } : body
  } catch { status.value = { ok: false, error: 'Cannot reach the wherdr server' } }
  finally { pending.value = false }
}
onMounted(check)
</script>

<template>
  <LockScreen v-if="needsUnlock" :after-unlock="check" />
  <main v-else class="core-connection">
    <h1>{{ t('herdr-core connection') }}</h1>
    <div role="status" aria-live="polite">
      <p v-if="pending">{{ t('Checking herdr-core…') }}</p>
      <p v-else-if="status?.ok">{{ t('Connected to herdr-core') }} · {{ status.version }}</p>
      <p v-else role="alert">{{ tl(status?.error || 'herdr-core is unavailable') }}</p>
      <p v-if="status?.hint">{{ t('Missing methods') }}: {{ status.hint }}</p>
    </div>
    <UButton class="mono-btn" :disabled="pending" @click="check">{{ t('Retry connection') }}</UButton>
  </main>
</template>

<style scoped>
.core-connection { max-width: 44rem; margin: auto; padding: max(24px, env(safe-area-inset-top)) 24px; overflow-wrap: anywhere; }
h1 { font-family: var(--mono); font-size: 1rem; text-transform: uppercase; border-bottom: 1px solid var(--line); padding-bottom: 16px; }
p { color: var(--text-2); }
button { min-height: 44px; min-width: 44px; }
</style>
