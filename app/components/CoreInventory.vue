<script setup lang="ts">
import { coreActivity, coreTitle, type CoreInventory, type CoreTerminal } from '../../shared/coreInventory'
const emit = defineEmits<{ locked: [] }>()
const inventory = ref<CoreInventory>()
const selected = ref<CoreTerminal>()
const pending = ref(false)
const error = ref('')
const labels: Record<string, string> = { idle: 'Ready', working: 'Working', blocked: 'Blocked', done: 'Done', error: 'Error', unknown: 'Unknown' }
async function load(address?: string) {
  pending.value = true
  error.value = ''
  // Never show stale details after a failed read or a machine disconnect.
  selected.value = undefined
  try {
    const response = await fetch('/api/core/terminals' + (address ? `?terminal=${encodeURIComponent(address)}` : ''), { cache: 'no-store' })
    if (response.status === 401) { emit('locked'); return }
    if (!response.ok) throw new Error(response.status === 404 ? 'Terminal no longer exists' : 'Cannot read herdr-core inventory')
    const body = await response.json()
    if (address) selected.value = body
    else inventory.value = body
  } catch (e) { error.value = e instanceof Error ? e.message : 'Cannot read herdr-core inventory' }
  finally { pending.value = false }
}
onMounted(() => load())
</script>

<template>
  <section class="core-inventory">
    <header class="agent-top">
      <UButton v-if="selected" class="icon-btn" icon="i-lucide-chevron-left" :aria-label="t('Back')" @click="load()" />
      <h2>{{ selected ? coreTitle(selected) : t('Terminals') }}</h2>
      <UButton class="mono-btn" :disabled="pending" @click="load(selected?.address)">{{ t('Refresh') }}</UButton>
    </header>
    <p v-if="pending" role="status">{{ t('Loading terminals…') }}</p>
    <p v-if="error" role="alert">{{ tl(error) }}</p>
    <template v-if="selected">
      <p class="card-state" :class="coreActivity(selected)"><i />{{ tl(labels[coreActivity(selected)]!) }}</p>
      <dl>
        <dt>{{ t('Address') }}</dt><dd>{{ selected.address }}</dd>
        <dt>{{ t('Program') }}</dt><dd>{{ selected.status?.app || selected.template || t('Unknown') }}</dd>
        <dt>{{ t('Directory') }}</dt><dd>{{ selected.cwd }}</dd>
        <dt>{{ t('Process') }}</dt><dd>{{ selected.state }}<template v-if="selected.reason"> · {{ selected.reason }}</template></dd>
      </dl>
      <p v-if="selected.status?.msg">{{ selected.status.msg }}</p>
      <p>{{ t('Conversation unavailable') }}</p>
    </template>
    <template v-else-if="!pending && !error && inventory">
      <p v-if="!inventory.terminals.length">{{ t('No live terminals') }}</p>
      <ul>
        <li v-for="terminal in inventory.terminals" :key="terminal.address">
          <button class="core-card" @click="load(terminal.address)">
            <strong>{{ coreTitle(terminal) }}</strong>
            <span class="card-state" :class="coreActivity(terminal)"><i />{{ tl(labels[coreActivity(terminal)]!) }}</span>
            <span>{{ terminal.address }} · {{ terminal.status?.app || terminal.template || t('Unknown') }}</span>
            <span>{{ terminal.cwd }}</span>
          </button>
        </li>
      </ul>
      <p v-for="machine in inventory.machines.filter(m => m.state !== 'connected')" :key="machine.name">{{ machine.name }} · {{ machine.state }}</p>
      <p v-if="inventory.hidden_finished">{{ tl(`${inventory.hidden_finished} finished terminals hidden`) }}</p>
    </template>
  </section>
</template>

<style scoped>
.agent-top { display: flex; align-items: center; gap: 8px; height: 44px; padding: 0; border-bottom: 1px solid var(--line); }
h2 { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: var(--display); }
button { min-height: 44px; }
ul { list-style: none; padding: 0; }
.core-card { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; width: 100%; text-align: left; padding: 16px; border: 1px solid var(--line); margin-top: 8px; background: var(--surface); color: var(--text); cursor: pointer; }
.core-card > span:not(.card-state) { grid-column: 1 / -1; color: var(--text-2); }
.card-state { width: auto; height: auto; white-space: nowrap; display: inline-flex; align-items: center; gap: 8px; font: 11px var(--mono); text-transform: uppercase; color: var(--dim); }
.card-state i { width: 7px; height: 7px; background: currentColor; }
.idle { color: var(--idle); }.idle i { background: transparent; box-shadow: inset 0 0 0 1px currentColor; }
.working { color: var(--working); }.blocked, .error { color: var(--blocked); }.done { color: var(--done); }
dt { font-family: var(--mono); color: var(--muted); text-transform: uppercase; margin-top: 16px; }
dd { margin: 4px 0; }
.core-inventory > p { margin-top: 16px; }
</style>
