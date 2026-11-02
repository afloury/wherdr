<script setup lang="ts">
// herdr-core machines: those core reached (state and last error), reconnect, and
// add one over SSH (like `hc machine add`). The machine must already accept this
// host's SSH login: wherdr never asks for a password nor installs anything.
const target = ref('')
const name = ref('')
const adding = ref(false)
const busyKey = ref('')
const error = ref('')
const remote = computed(() => machines.value.filter(m => !m.local))
const STATE: Record<string, string> = { online: 'connected', connecting: 'connecting…', offline: 'offline' }

async function add() {
  if (!target.value.trim() || adding.value) return
  adding.value = true
  error.value = ''
  try {
    await api('/api/machine/add', { target: target.value.trim(), ...(name.value.trim() ? { name: name.value.trim() } : {}) })
    toast(t('Machine added'))
    target.value = ''
    name.value = ''
    loadConfig()
  } catch (err) { error.value = (err as Error).message }
  finally { adding.value = false }
}
async function reconnect(key: string) {
  busyKey.value = key
  error.value = ''
  try { await api('/api/machine/connect', { key }) }
  catch (err) { error.value = (err as Error).message }
  finally { busyKey.value = '' }
}
</script>

<template>
  <div class="settings-group core-machines">
    <h3>{{ t('Machines') }}</h3>
    <p class="muted settings-hint">{{ t('Other machines running herdr-core, reached over SSH. Terminals and agents can be started on them from New.') }}</p>
    <div class="settings-card">
      <div class="machine-row"><b>{{ hostLabel || t('This machine') }}</b><span class="mono-label">{{ t('this machine') }}</span></div>
      <div v-for="m in remote" :key="m.key" class="machine-row" data-testid="core-machine">
        <span><b>{{ m.label }}</b><small v-if="m.error" class="muted">{{ m.error }}</small></span>
        <span class="mono-label" :data-status="m.status">{{ t(STATE[m.status] || m.status) }}</span>
        <UButton v-if="m.status !== 'online'" color="neutral" variant="outline" size="sm" :loading="busyKey === m.key" @click="reconnect(m.key)">{{ t('Reconnect') }}</UButton>
      </div>
    </div>
    <form class="sheet-form" @submit.prevent="add">
      <label class="field-label" for="machineTarget">{{ t('SSH target') }}</label>
      <UInput id="machineTarget" v-model="target" size="xl" class="w-full mono" autocapitalize="none" autocorrect="off" :spellcheck="false" placeholder="user@10.0.0.7" maxlength="200" />
      <label class="field-label" for="machineName">{{ t('Name') }} <span class="muted">{{ t('(optional)') }}</span></label>
      <UInput id="machineName" v-model="name" size="xl" class="w-full mono" autocapitalize="none" autocorrect="off" :spellcheck="false" placeholder="vps" maxlength="32" />
      <p v-if="error" class="form-error" role="alert">{{ t(error) }}</p>
      <UButton type="submit" size="xl" color="primary" variant="solid" class="hw-cta" icon="i-lucide-plus" :loading="adding" :disabled="!target.trim()">{{ t('Add machine') }}</UButton>
    </form>
  </div>
</template>

<style scoped>
.machine-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 13px 16px; border-bottom: 1px solid var(--line); }
.machine-row:last-child { border-bottom: 0; }
.machine-row span:first-child { display: grid; gap: 2px; min-width: 0; overflow-wrap: anywhere; }
.mono-label { font-family: var(--font-mono, 'JetBrains Mono', monospace); text-transform: uppercase; letter-spacing: .08em; font-size: 12px; color: var(--text-2); }
.mono-label[data-status='online'] { color: var(--green, var(--text)); }
.core-machines .settings-card { padding: 0; margin-top: 12px; }
.core-machines form { margin-top: 16px; }
</style>
