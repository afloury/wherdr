<script setup lang="ts">
// "+ New task" on the Board: a title, a description, the repo it belongs to,
// then herdr-projects `add` on that machine (`--repo`; the home folder when
// none). "Start now" adds `--delegate`: an agent is put on it at once.
// Without it the task waits under "To do" (the backlog) until Start.
import { TELL_MAX, TITLE_MAX, cleanRepo } from '#shared/projectsTasks'

// `machines`: the boards that take actions, `repos`: each one's repos as its tasks show them.
const props = defineProps<{ machines: string[], repos: Record<string, string[]>, machine?: string, repo?: string }>()
const emit = defineEmits<{ added: [machine: string] }>()
const open = defineModel<boolean>('open', { default: false })

// Choices that are not a repo's name. A select's item cannot have an empty
// value (Reka refuses it), so the home folder has one of its own.
const HOME = '\u0000home'
const OTHER = '\u0000other'
const machine = ref('')
const repoPick = ref(HOME) // HOME, a repo's name, or OTHER
const other = ref('')
const title = ref('')
const description = ref('')
const start = ref(false)
const busy = ref(false)
const error = ref('')

const repoItems = computed(() => [
  { label: tl('Home folder', 'Dossier personnel'), value: HOME },
  ...(props.repos[machine.value] || []).map(r => ({ label: r, value: r })),
  { label: tl('Other repo or folder…', 'Autre dépôt ou dossier…'), value: OTHER },
])
const repo = computed(() => (repoPick.value === OTHER ? other.value.trim() : repoPick.value === HOME ? '' : repoPick.value))
const repoOk = computed(() => cleanRepo(repo.value) !== null && (repoPick.value !== OTHER || Boolean(repo.value)))

watch(open, (o) => {
  if (!o) return
  machine.value = props.machine && props.machines.includes(props.machine) ? props.machine : props.machines[0] ?? ''
  repoPick.value = props.repo || HOME
  other.value = ''
  title.value = ''
  description.value = ''
  start.value = false
  error.value = ''
}, { immediate: true })
// Another machine: its own repos.
watch(machine, () => { if (repoPick.value !== OTHER && repoPick.value !== HOME && !(props.repos[machine.value] || []).includes(repoPick.value)) repoPick.value = HOME })

async function add() {
  if (busy.value || !title.value.trim()) return
  if (!repoOk.value) { error.value = tl('A repo’s name, or a folder’s path (/… or ~/…)', 'Le nom d’un dépôt, ou le chemin d’un dossier (/… ou ~/…)'); return }
  busy.value = true
  error.value = ''
  try {
    const r = await api<{ msg: string }>('/api/tasks/add', { machine: machine.value, title: title.value, description: description.value, repo: repo.value, delegate: start.value })
    haptic()
    toast(r.msg || (start.value ? tl('Added, an agent is on it', 'Ajoutée, un agent s’en occupe') : tl('Added to To do', 'Ajoutée à À faire')))
    emit('added', machine.value)
    open.value = false
  } catch (e) { error.value = (e as Error).message }
  finally { busy.value = false }
}
</script>

<template>
  <AppSheet v-model:open="open" :title="tl('New task', 'Nouvelle tâche')" tall>
    <form class="sheet-form new-task" @submit.prevent="add">
      <template v-if="machines.length > 1">
        <span class="field-label">{{ t('Machine') }}</span>
        <div class="segmented" :style="{ '--segment-count': machines.length }">
          <button v-for="m in machines" :key="m" type="button" :class="{ on: m === machine }" :data-machine="m || 'local'" @click="machine = m">
            <span class="machine-choice-name">{{ machineName(m) || hostLabel || t('This machine') }}</span>
          </button>
        </div>
      </template>

      <label class="field-label" for="new-task-repo">{{ tl('Repo', 'Dépôt') }}</label>
      <!-- Its list opens above the sheet (windows sit at z-index 20–23), so it can be picked from. -->
      <USelect id="new-task-repo" v-model="repoPick" :items="repoItems" size="xl" class="w-full" :ui="{ content: 'z-[30]' }" />
      <UInput
        v-if="repoPick === OTHER" v-model="other" size="xl" class="w-full mono" autocapitalize="none" autocorrect="off" :spellcheck="false"
        :placeholder="tl('Repo name, or /path/to/folder', 'Nom du dépôt, ou /chemin/du/dossier')" maxlength="500" :aria-label="tl('Repo or folder', 'Dépôt ou dossier')"
      />

      <label class="field-label" for="new-task-title">{{ tl('Title', 'Titre') }}</label>
      <UInput
        id="new-task-title" v-model="title" size="xl" class="w-full" :maxlength="TITLE_MAX" enterkeyhint="next"
        :placeholder="tl('E.g. Dark mode toggle in Settings', 'Ex. Bouton de thème sombre dans les réglages')"
      />

      <label class="field-label" for="new-task-desc">{{ tl('Description', 'Description') }} <span class="muted">{{ t('(optional)') }}</span></label>
      <UTextarea
        id="new-task-desc" v-model="description" :rows="4" autoresize :maxrows="12" size="xl" class="w-full" :maxlength="TELL_MAX"
        :placeholder="tl('What the agent needs to know: the goal, where to look, how to check it', 'Ce que l’agent doit savoir : le but, où regarder, comment vérifier')"
      />

      <label class="toggle-row">
        <span><b>{{ tl('Start now', 'Lancer tout de suite') }}</b><small>{{ start ? tl('an agent is put on it at once', 'un agent s’en occupe tout de suite') : tl('it waits under To do until you start it', 'elle attend dans À faire jusqu’à ce que tu la lances') }}</small></span>
        <USwitch v-model="start" color="success" size="xl" />
      </label>
      <button type="submit" hidden />
    </form>
    <template #footer>
      <div class="sheet-form">
        <p v-if="error" class="form-error">{{ error }}</p>
        <UButton
          block size="xl" color="primary" class="launch-btn hw-cta" :icon="start ? 'i-lucide-play' : 'i-lucide-plus'" :loading="busy"
          :disabled="!title.trim() || !machine && machines.length === 0 || offlineView" @click="add"
        >
          {{ start ? tl('Add and start', 'Ajouter et lancer') : tl('Add to To do', 'Ajouter à À faire') }}
        </UButton>
      </div>
    </template>
  </AppSheet>
</template>
