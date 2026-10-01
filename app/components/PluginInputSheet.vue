<script setup lang="ts">
import { projectNameOk } from '#shared/projectsActions'

const open = computed({ get: () => pluginFormState.open, set: (v) => { if (!v) closePluginForm() } })
const action = computed(() => pluginFormState.action?.id || '')
const isName = computed(() => action.value === 'new' || action.value === 'adopt-workspace')
const valid = computed(() => pluginFormValid())
const canSwitch = computed(() => action.value === 'adopt-workspace' && pluginFormState.empty === true && Boolean(newProjectAction()))
const input = ref<{ inputRef?: HTMLInputElement } | null>(null)
const browsing = ref(false)
watch(open, (v) => {
  browsing.value = false
  if (v) setTimeout(() => input.value?.inputRef?.focus(), 80)
})
const f = pluginFormState
const nameBad = computed(() => isName.value && Boolean(f.name.trim()) && !projectNameOk(f.name))

// « New project » : machine du dépôt (choix seulement pour un projet de la
// machine locale : herdr-projects y vise une autre machine par son id), puis
// dossier comme dans « Nouvel agent » (navigateur, récents de cette machine).
const projectMachine = computed(() => pluginTargetMachine(f.target))
const repoMachines = computed(() => (machineInfo(projectMachine.value)?.local ? machineChoices.value : null))
const repoCfg = computed(() => machineChoices.value?.find(m => m.key === f.machine))
const repoHome = computed(() => (repoCfg.value ? repoCfg.value.home : appConfig.value.home))
// Récents de la machine, sans le HOME (jamais un dépôt de projet).
const recents = computed(() => ((repoCfg.value ? repoCfg.value.dirs : appConfig.value.dirs) || [])
  .filter(d => d !== repoHome.value && shortPath(d) !== '~').slice(0, 6))
const repo = computed({ get: () => f.repo, set: (v) => { f.repo = v || ''; checkPluginRepo() } })
function chooseRepo(d: string) {
  repo.value = d
  browsing.value = false
}
function useRoot() {
  if (f.repoRoot) repo.value = f.repoRoot
}
</script>

<template>
  <AppSheet v-model:open="open" :title="pluginFormState.action?.label || t('Plugin actions')" :tall="browsing">
    <DirBrowser v-if="browsing" :start="f.repo || null" :machine="f.machine" @choose="chooseRepo" @cancel="browsing = false" />
    <form v-else class="rename plugin-input" @submit.prevent="submitPluginForm">
      <template v-if="action === 'adopt-workspace'">
        <div class="plugin-input-note">
          <UIcon name="i-lucide-git-branch-plus" />
          <p>{{ tl('This space’s agent becomes the project’s first thread, as an adopted thread: it stays in its workspace and keeps its conversation, but herdr-projects cannot restart it. A coordinator is opened for the project.', 'L’agent de ce space devient le premier thread du projet, en mode adopté : il reste dans son workspace et garde sa conversation, mais herdr-projects ne pourra pas le redémarrer. Un coordinateur est ouvert pour le projet.') }}</p>
        </div>
        <div v-if="pluginFormState.empty === true" class="plugin-input-note warn">
          <UIcon name="i-lucide-triangle-alert" />
          <div>
            <p>{{ tl('This agent’s conversation is empty: there is nothing to continue. A new project starts its own threads, which it can restart.', 'La conversation de cet agent est vide : il n’y a rien à reprendre. Un nouveau projet démarre ses threads lui-même, qu’il peut relancer.') }}</p>
            <UButton v-if="canSwitch" size="sm" color="primary" variant="outline" icon="i-lucide-folder-plus" :disabled="pluginFormState.busy" @click="switchToNewProject">{{ tl('Create a new project', 'Créer un nouveau projet') }}</UButton>
          </div>
        </div>
      </template>

      <label class="plugin-input-label" for="plugin-primary">{{ isName ? tl('Project name', 'Nom du projet') : tl('Project slug', 'Identifiant du projet') }}</label>
      <UInput v-if="isName" id="plugin-primary" ref="input" :model-value="pluginFormState.name" maxlength="120" size="xl" class="w-full" required
        :placeholder="action === 'new' ? tl('Repository name, or another name', 'Nom du dépôt, ou un autre nom') : undefined" @update:model-value="setPluginFormName(String($event ?? ''))" />
      <UInput v-else id="plugin-primary" ref="input" v-model="pluginFormState.slug" maxlength="120" size="xl" class="w-full" required />
      <p v-if="nameBad" class="plugin-input-hint bad">{{ tl('A project name has letters or digits, and no “/” or “..”.', 'Un nom de projet contient des lettres ou des chiffres, sans « / » ni « .. ».') }}</p>
      <p v-if="action === 'adopt-workspace'" class="plugin-input-hint">{{ tl('The suggested name comes from the selected space.', 'Le nom proposé vient du space sélectionné.') }}</p>

      <template v-if="isName">
        <label class="plugin-input-label" for="plugin-goal">{{ tl('Goal (optional)', 'Objectif (facultatif)') }}</label>
        <UTextarea id="plugin-goal" v-model="pluginFormState.goal" :rows="2" autoresize :maxrows="5" maxlength="400" size="xl" class="w-full"
          :placeholder="tl('Maintain and evolve the project', 'Maintenir et faire évoluer le projet')" />
        <p class="plugin-input-hint">{{ tl('The project’s direction, reread by the coordinator every turn. For an ongoing project: “Maintain and evolve …”. Editable later in PROJECT.md.', 'Le cap du projet, relu par le coordinateur à chaque tour. Pour un projet continu : « Maintenir et faire évoluer … ». Modifiable plus tard dans PROJECT.md.') }}</p>
      </template>

      <template v-if="action === 'adopt-workspace'">
        <label class="plugin-input-label" for="plugin-task">{{ tl('Current task (optional)', 'Tâche en cours (facultatif)') }}</label>
        <UInput id="plugin-task" v-model="pluginFormState.task" maxlength="400" size="xl" class="w-full"
          :placeholder="tl('What the agent is working on', 'Ce que l’agent est en train de faire')" />
        <p class="plugin-input-hint">{{ tl('Added to the project’s goal (the plugin has no dedicated field).', 'Ajoutée à l’objectif du projet (le plugin n’a pas de champ dédié).') }}</p>
      </template>

      <template v-if="action === 'new'">
        <template v-if="repoMachines">
          <label class="plugin-input-label">{{ t('Machine') }}</label>
          <MachineChoice :machines="repoMachines" :model-value="f.machine" @pick="setPluginRepoMachine($event.key)" />
        </template>
        <label class="plugin-input-label">{{ tl('Repository (optional)', 'Dépôt (facultatif)') }}</label>
        <DirField v-model="repo" :recents="recents" clearable :placeholder="tl('No repository', 'Aucun dépôt')" @browse="browsing = true" />
        <p v-if="f.repo && f.repoState === 'checking'" class="repo-state"><span class="spinner" />{{ tl('Checking…', 'Vérification…') }}</p>
        <p v-else-if="f.repo && f.repoState === 'repo'" class="repo-state repo"><UIcon name="i-lucide-git-branch" />{{ tl('Git repository', 'Dépôt Git') }}</p>
        <div v-else-if="f.repo && f.repoState === 'inside'" class="repo-state inside">
          <UIcon name="i-lucide-corner-left-up" />
          <span>{{ tl('Inside the repository', 'Sous-dossier du dépôt') }} <code>{{ ltr(shortPath(f.repoRoot)) }}</code></span>
          <UButton size="xs" color="primary" variant="outline" icon="i-lucide-arrow-up-to-line" @click="useRoot">{{ tl('Use the root', 'Prendre la racine') }}</UButton>
        </div>
        <p v-else-if="f.repo && f.repoState === 'none'" class="repo-state none"><UIcon name="i-lucide-triangle-alert" />{{ tl('Not a Git repository: choose one, or clear the field.', 'Pas un dépôt Git : choisissez-en un, ou videz le champ.') }}</p>
        <p v-if="!f.repo || f.repoState === 'repo'" class="plugin-input-hint">{{ f.repo ? tl('The project’s threads will work in worktrees of this repository.', 'Les threads du projet travailleront dans des worktrees de ce dépôt.') : tl('Without a repository, each thread runs in a tab of the project.', 'Sans dépôt, chaque thread travaille dans un onglet du projet.') }}</p>
      </template>

      <div class="rename-actions">
        <UButton color="neutral" variant="ghost" class="sheet-btn" :disabled="pluginFormState.busy" @click="closePluginForm">{{ t('Cancel') }}</UButton>
        <UButton type="submit" color="primary" variant="solid" class="sheet-btn hw-cta" :loading="pluginFormState.busy" :disabled="!valid">{{ t('Run') }}</UButton>
      </div>
    </form>
  </AppSheet>
</template>
