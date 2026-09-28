<script setup lang="ts">
const open = computed({ get: () => pluginFormState.open, set: (v) => { if (!v) closePluginForm() } })
const action = computed(() => pluginFormState.action?.id || '')
const isName = computed(() => action.value === 'new' || action.value === 'adopt-workspace')
const valid = computed(() => pluginFormValid())
const canSwitch = computed(() => action.value === 'adopt-workspace' && pluginFormState.empty === true && Boolean(newProjectAction()))
const input = ref<{ inputRef?: HTMLInputElement } | null>(null)
watch(open, (v) => { if (v) setTimeout(() => input.value?.inputRef?.focus(), 80) })
</script>

<template>
  <AppSheet v-model:open="open" :title="pluginFormState.action?.label || t('Actions des plugins')">
    <form class="rename plugin-input" @submit.prevent="submitPluginForm">
      <template v-if="action === 'adopt-workspace'">
        <div class="plugin-input-note">
          <UIcon name="i-lucide-git-branch-plus" />
          <p>{{ tl('L’agent de ce space devient le premier thread du projet, en mode adopté : il reste dans son workspace et garde sa conversation, mais herdr-projects ne pourra pas le redémarrer. Un coordinateur est ouvert pour le projet.', 'This space’s agent becomes the project’s first thread, as an adopted thread: it stays in its workspace and keeps its conversation, but herdr-projects cannot restart it. A coordinator is opened for the project.') }}</p>
        </div>
        <div v-if="pluginFormState.empty === true" class="plugin-input-note warn">
          <UIcon name="i-lucide-triangle-alert" />
          <div>
            <p>{{ tl('La conversation de cet agent est vide : il n’y a rien à reprendre. Un nouveau projet démarre ses threads lui-même, qu’il peut relancer.', 'This agent’s conversation is empty: there is nothing to continue. A new project starts its own threads, which it can restart.') }}</p>
            <UButton v-if="canSwitch" size="sm" color="primary" variant="outline" icon="i-lucide-folder-plus" :disabled="pluginFormState.busy" @click="switchToNewProject">{{ tl('Créer un nouveau projet', 'Create a new project') }}</UButton>
          </div>
        </div>
      </template>

      <label class="plugin-input-label" for="plugin-primary">{{ isName ? tl('Nom du projet', 'Project name') : tl('Identifiant du projet', 'Project slug') }}</label>
      <UInput v-if="isName" id="plugin-primary" ref="input" v-model="pluginFormState.name" maxlength="120" size="xl" class="w-full" required />
      <UInput v-else id="plugin-primary" ref="input" v-model="pluginFormState.slug" maxlength="120" size="xl" class="w-full" required />
      <p v-if="action === 'adopt-workspace'" class="plugin-input-hint">{{ tl('Le nom proposé vient du space sélectionné.', 'The suggested name comes from the selected space.') }}</p>

      <template v-if="isName">
        <label class="plugin-input-label" for="plugin-goal">{{ tl('Objectif', 'Goal') }}</label>
        <UTextarea id="plugin-goal" v-model="pluginFormState.goal" :rows="2" autoresize :maxrows="5" maxlength="400" size="xl" class="w-full" required
          :placeholder="tl('Ce que le projet doit accomplir', 'What the project should achieve')" />
        <p class="plugin-input-hint">{{ tl('Le coordinateur le lit à chaque tour : une ou deux phrases sur le résultat attendu.', 'The coordinator reads it every turn: one or two sentences on the expected outcome.') }}</p>
      </template>

      <template v-if="action === 'adopt-workspace'">
        <label class="plugin-input-label" for="plugin-task">{{ tl('Tâche en cours (facultatif)', 'Current task (optional)') }}</label>
        <UInput id="plugin-task" v-model="pluginFormState.task" maxlength="400" size="xl" class="w-full"
          :placeholder="tl('Ce que l’agent est en train de faire', 'What the agent is working on')" />
        <p class="plugin-input-hint">{{ tl('Ajoutée à l’objectif du projet (le plugin n’a pas de champ dédié).', 'Added to the project’s goal (the plugin has no dedicated field).') }}</p>
      </template>

      <template v-if="action === 'new'">
        <label class="plugin-input-label" for="plugin-repo">{{ tl('Dépôt (facultatif)', 'Repository (optional)') }}</label>
        <UInput id="plugin-repo" v-model="pluginFormState.repo" maxlength="1024" size="xl" class="w-full plugin-input-mono"
          :placeholder="tl('Chemin d’un dépôt Git', 'Path to a Git repository')" />
        <p class="plugin-input-hint">{{ pluginFormState.repo ? tl('Proposé : le dépôt Git du space courant. Vide = aucun dépôt.', 'Suggested: the current space’s Git repository. Empty = no repository.') : tl('Les threads du projet travailleront dans des worktrees de ce dépôt.', 'The project’s threads will work in worktrees of this repository.') }}</p>
      </template>

      <div class="rename-actions">
        <UButton color="neutral" variant="ghost" class="sheet-btn" :disabled="pluginFormState.busy" @click="closePluginForm">{{ t('Annuler') }}</UButton>
        <UButton type="submit" color="primary" variant="solid" class="sheet-btn hw-cta" :loading="pluginFormState.busy" :disabled="!valid">{{ t('Exécuter') }}</UButton>
      </div>
    </form>
  </AppSheet>
</template>
