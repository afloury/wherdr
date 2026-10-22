<script setup lang="ts">
import type { MachineInfo } from '#shared/types'
import type { MachineDiagnostic } from '#shared/machineDiagnostics'

const props = defineProps<{ machine: MachineInfo }>()
const diagnostic = ref<MachineDiagnostic | null>(null)
const busy = ref(false)
const error = ref('')
let request = 0
async function check(retry = false) {
  const id = ++request
  const key = props.machine.key
  busy.value = true
  error.value = ''
  diagnostic.value = null
  try {
    if (retry) await api('/api/machine/reconnect', { key })
    const result = await api<MachineDiagnostic>('/api/machine/status', { key })
    if (id === request) diagnostic.value = result
  } catch (err) { if (id === request) error.value = (err as Error).message }
  finally { if (id === request) busy.value = false }
}
watch(() => props.machine.key, () => { diagnostic.value = null; void check() }, { immediate: true })
onBeforeUnmount(() => { ++request })
const status = computed(() => {
  switch (diagnostic.value?.status) {
    case 'reachable': return t('Reachable')
    case 'auth required': return t('Authentication required')
    case 'disabled': return t('Disabled')
    case 'error': return t('Connection failed')
    default: return ''
  }
})
async function copy() {
  try { await navigator.clipboard.writeText(diagnostic.value!.reconnect!); toast(t('Copied')) }
  catch (err) { toast((err as Error).message, true) }
}
</script>

<template>
  <div class="machine-connection">
    <p><strong>{{ machine.label }}</strong></p>
    <p v-if="machine.error">{{ t(machine.error) }}</p>
    <p v-if="status" role="status">{{ status }}</p>
    <p v-if="diagnostic?.error">{{ t(diagnostic.error) }}</p>
    <p v-if="diagnostic && !diagnostic.supported">{{ t('Machine diagnostics require Herdr 0.9.2 or later. The wherdr connection still retries automatically.') }}</p>
    <template v-if="diagnostic?.reconnect">
      <p>{{ t('For SSH authentication, run this command in a terminal on the machine running wherdr, then retry the connection here.') }}</p>
      <p>{{ t('Herdr authentication and the wherdr SSH connection are checked separately.') }}</p>
      <code>{{ diagnostic.reconnect }}</code>
      <UButton color="neutral" variant="outline" @click="copy">{{ t('Copy command') }}</UButton>
    </template>
    <p v-if="error" role="alert">{{ t(error) }}</p>
    <div class="sheet-actions">
      <UButton color="neutral" variant="outline" :loading="busy" :disabled="busy" @click="check()">{{ t('Check status') }}</UButton>
      <UButton color="neutral" :disabled="busy" @click="check(true)">{{ t('Retry connection') }}</UButton>
    </div>
  </div>
</template>

<style scoped>
.machine-connection { display: grid; gap: 16px; }
.sheet-actions { display: flex; flex-wrap: wrap; gap: 8px; }
code { display: block; padding: 12px; border: 1px solid var(--line); overflow-wrap: anywhere; user-select: text; }
</style>
