<script setup lang="ts">
// Full-screen progress of a one-tap update (useUpdate.ts runSelfUpdate):
// steps while wherdr installs and restarts, then the reload, or the error
// and the version it rolled back to.
const steps = computed(() => [
  { id: 'installing', label: tl(`Installing ${selfUpdate.to}`, `Installation de ${selfUpdate.to}`) },
  { id: 'restarting', label: t('Restarting wherdr') },
  { id: 'checking', label: t('Checking the new version') },
])
const order = ['installing', 'restarting', 'checking', 'done']
const state = computed(() => selfUpdate.job?.state ?? 'installing')
const failed = computed(() => !!selfUpdate.error || selfUpdate.timedOut || ['rolling-back', 'rolled-back', 'failed'].includes(state.value))
const finished = computed(() => !!selfUpdate.error || selfUpdate.timedOut || state.value === 'rolled-back' || state.value === 'failed')
const title = computed(() => {
  if (state.value === 'rolled-back') return tl(`Rolled back to ${selfUpdate.job!.from}`, `Retour à ${selfUpdate.job!.from}`)
  if (state.value === 'rolling-back') return t('Going back to the previous version…')
  if (failed.value) return t('Update failed')
  if (state.value === 'done') return t('Reloading…')
  return t('Updating…')
})
const detail = computed(() => {
  if (selfUpdate.error) return selfUpdate.error
  if (selfUpdate.timedOut) return t('wherdr did not come back in 5 minutes. See ~/wherdr/update.log on the server.')
  return selfUpdate.job?.message || ''
})
const stepState = (id: string) => {
  const at = order.indexOf(state.value)
  const i = order.indexOf(id)
  if (at < 0) return failed.value && id === 'checking' ? 'bad' : 'done'
  return i < at ? 'done' : i === at ? 'now' : 'todo'
}
</script>

<template>
  <div class="lock-screen self-update" role="alertdialog" aria-live="polite" :aria-label="title">
    <div class="lock-box">
      <p class="eyebrow">{{ t('wherdr update') }}</p>
      <h2>{{ title }}</h2>
      <ol v-if="!selfUpdate.error" class="self-update-steps">
        <li v-for="s in steps" :key="s.id" :class="stepState(s.id)">
          <UIcon v-if="stepState(s.id) === 'done'" name="i-lucide-check" />
          <UIcon v-else-if="stepState(s.id) === 'bad'" name="i-lucide-x" />
          <span v-else-if="stepState(s.id) === 'now' && !finished" class="spinner" />
          <span v-else class="self-update-dot" />
          {{ s.label }}
        </li>
      </ol>
      <p v-if="detail" class="self-update-detail" :class="{ bad: failed }">{{ detail }}</p>
      <p v-else-if="!finished" class="muted">{{ t('The app reloads by itself on the new version. Agents keep running.') }}</p>
      <UButton v-if="finished" block size="xl" variant="solid" color="primary" class="lock-btn" @click="closeSelfUpdate">{{ t('Close') }}</UButton>
    </div>
  </div>
</template>
