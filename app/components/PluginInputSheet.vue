<script setup lang="ts">
const open = computed({ get: () => pluginFormState.open, set: (v) => { if (!v) closePluginForm() } })
const action = computed(() => pluginFormState.action?.id || '')
const isName = computed(() => action.value === 'new' || action.value === 'adopt-workspace')
const valid = computed(() => Boolean((isName.value ? pluginFormState.name : pluginFormState.slug).trim()))
const input = ref<{ inputRef?: HTMLInputElement } | null>(null)
watch(open, (v) => { if (v) setTimeout(() => input.value?.inputRef?.focus(), 80) })
</script>

<template>
  <AppSheet v-model:open="open" :title="pluginFormState.action?.label || t('Actions des plugins')">
    <form class="rename plugin-input" @submit.prevent="submitPluginForm">
      <label class="plugin-input-label" for="plugin-primary">{{ isName ? tl('Nom du projet', 'Project name') : tl('Identifiant du projet', 'Project slug') }}</label>
      <UInput v-if="isName" id="plugin-primary" ref="input" v-model="pluginFormState.name" maxlength="120" size="xl" class="w-full" required />
      <UInput v-else id="plugin-primary" ref="input" v-model="pluginFormState.slug" maxlength="120" size="xl" class="w-full" required />
      <template v-if="action === 'new'">
        <label class="plugin-input-label" for="plugin-goal">{{ tl('Objectif (facultatif)', 'Goal (optional)') }}</label>
        <UInput id="plugin-goal" v-model="pluginFormState.goal" maxlength="120" size="xl" class="w-full" />
      </template>
      <p v-if="action === 'adopt-workspace'" class="plugin-input-hint">{{ tl('Le nom proposé vient du space sélectionné.', 'The suggested name comes from the selected space.') }}</p>
      <div class="rename-actions">
        <UButton color="neutral" variant="ghost" class="sheet-btn" :disabled="pluginFormState.busy" @click="closePluginForm">{{ t('Annuler') }}</UButton>
        <UButton type="submit" color="primary" variant="solid" class="sheet-btn hw-cta" :loading="pluginFormState.busy" :disabled="!valid">{{ t('Exécuter') }}</UButton>
      </div>
    </form>
  </AppSheet>
</template>
