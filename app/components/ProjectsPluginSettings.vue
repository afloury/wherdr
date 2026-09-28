<script setup lang="ts">
import type { MachineConfig } from '#shared/types'
import { PROJECTS_COMMAND } from '#shared/projectsPlugin'
import { coordinatorRules, tasksTemplate } from '#shared/projectBoard'

const props = defineProps<{ machines: MachineConfig[] }>()
type PluginState = { installed: boolean, enabled: boolean, version: string | null, installable: boolean }
const states = ref<Record<string, PluginState>>({})
const errors = ref<Record<string, string>>({})
const loading = ref<Record<string, boolean>>({})
const busy = ref<Record<string, boolean>>({})

async function refresh(machine: MachineConfig) {
  if (!machine.online) return
  loading.value = { ...loading.value, [machine.key]: true }
  try {
    const state = await api<PluginState>(`/api/plugins/projects?machine=${encodeURIComponent(machine.key)}`)
    states.value = { ...states.value, [machine.key]: state }
    errors.value = { ...errors.value, [machine.key]: '' }
  } catch (e) { errors.value = { ...errors.value, [machine.key]: (e as Error).message } }
  finally { loading.value = { ...loading.value, [machine.key]: false } }
}

watch(() => props.machines.map(m => `${m.key}:${m.online}`).join('|'), () => {
  for (const machine of props.machines) refresh(machine)
}, { immediate: true })

async function install(machine: MachineConfig) {
  haptic()
  if (!await askConfirm(tl(
    `Installer herdr-projects sur ${machine.label} ? Herdr téléchargera le plugin depuis GitHub et exécutera son installation sur cette machine.`,
    `Install herdr-projects on ${machine.label}? Herdr will download the plugin from GitHub and run its installer on this machine.`,
  ), t('Installer'), 'primary')) return
  busy.value = { ...busy.value, [machine.key]: true }
  try {
    await api('/api/plugins/projects', { machine: machine.key })
    toast(tl(`herdr-projects installé sur ${machine.label}.`, `herdr-projects installed on ${machine.label}.`))
    await refresh(machine)
  } catch (e) { toast((e as Error).message, true) }
  finally { busy.value = { ...busy.value, [machine.key]: false } }
}

async function copy(machine: MachineConfig) {
  haptic()
  try {
    await navigator.clipboard.writeText(PROJECTS_COMMAND)
    toast(tl(`Commande copiée : colle-la dans un terminal de ${machine.label}.`, `Command copied: paste it into a terminal on ${machine.label}.`))
  } catch { toast(t('Copie impossible'), true) }
}

// Tableau du projet : listes reconnues dans TASKS.md (synonymes de KINDS,
// shared/projectBoard.ts) et textes à copier.
const boardLists = computed(() => [
  { icon: 'i-lucide-flask-conical', name: tl('À tester', 'To test'), also: 'To test, Testing, À vérifier', what: tl('Ce que tu dois vérifier : Confirmer, Problème, Question.', 'What you must check: Confirm, Problem, Question.') },
  { icon: 'i-lucide-circle-help', name: tl('À décider', 'To decide'), also: 'To decide, Décisions, Questions', what: tl('Questions pour toi : Répondre.', 'Questions for you: Answer.') },
  { icon: 'i-lucide-loader', name: tl('En cours', 'In progress'), also: 'In progress, Doing, WIP', what: tl('Threads ouverts, en direct.', 'Open threads, live.') },
  { icon: 'i-lucide-list-todo', name: 'Backlog', also: 'À faire, Todo, Next, Later, Idées', what: tl('Lancer envoie la tâche au coordinateur ; Préciser prépare un message.', 'Launch sends the task to the coordinator; Clarify prepares a message.') },
  { icon: 'i-lucide-check', name: tl('Fait', 'Done'), also: 'Done, Terminé, Finished', what: tl('Remplie par les threads clôturés.', 'Filled by resolved threads.') },
])
async function copyText(text: string, done: string) {
  haptic()
  try {
    await navigator.clipboard.writeText(text)
    toast(done)
  } catch { toast(t('Copie impossible'), true) }
}
const lang = () => (language === 'en' ? 'en' : 'fr')
const copyTemplate = () => copyText(tasksTemplate(lang()), tl('Modèle copié : colle-le dans TASKS.md du projet.', 'Template copied: paste it into the project’s TASKS.md.'))
const copyRules = () => copyText(coordinatorRules(lang()), tl('Règles copiées : colle-les au coordinateur.', 'Rules copied: paste them to the coordinator.'))
</script>

<template>
  <div class="settings-group projects-plugin">
    <h3>herdr-projects</h3>
    <p class="projects-plugin-intro">{{ tl('herdr-projects regroupe les coordinateurs et leurs threads par projet, avec un panneau Projet et les dépôts de worktrees dans wherdr. Le plugin est facultatif : les agents et les autres fonctions de wherdr restent utilisables sans lui.', 'herdr-projects groups coordinators and their threads by project, adding the Project panel and worktree repositories in wherdr. The plugin is optional: agents and other wherdr features still work without it.') }}</p>
    <a class="projects-plugin-link" href="https://github.com/eliasstravik/herdr-projects" target="_blank" rel="noopener noreferrer">
      {{ tl('Voir le dépôt du plugin', 'View plugin repository') }} <UIcon name="i-lucide-external-link" />
    </a>
    <div v-for="machine in machines" :key="machine.key" class="projects-plugin-machine">
      <div class="projects-plugin-head">
        <strong>{{ machine.label }}</strong>
        <span v-if="!machine.online">{{ tl('Hors ligne', 'Offline') }}</span>
        <span v-else-if="loading[machine.key] && !states[machine.key]">{{ tl('Vérification…', 'Checking…') }}</span>
        <span v-else-if="errors[machine.key]">{{ tl('État indisponible', 'Status unavailable') }}</span>
        <span v-else-if="states[machine.key]?.installed" class="installed">{{ tl('Installé', 'Installed') }}{{ states[machine.key]?.version ? ` · v${states[machine.key]?.version}` : '' }}</span>
        <span v-else>{{ tl('Non installé', 'Not installed') }}</span>
      </div>
      <p v-if="machine.online && errors[machine.key]" class="projects-plugin-note">{{ errors[machine.key] }}</p>
      <template v-if="machine.online && states[machine.key] && !states[machine.key]?.installed && !errors[machine.key]">
        <div class="projects-plugin-actions">
          <UButton v-if="states[machine.key]?.installable" size="sm" color="primary" icon="i-lucide-download" :loading="busy[machine.key]" @click="install(machine)">{{ t('Installer') }}</UButton>
          <UButton size="sm" color="neutral" variant="outline" icon="i-lucide-copy" @click="copy(machine)">{{ t('Copier la commande') }}</UButton>
        </div>
        <p v-if="!states[machine.key]?.installable" class="projects-plugin-note">{{ tl('Installation directe indisponible ici : lance la commande sur cette machine.', 'Direct installation is unavailable here: run the command on this machine.') }}</p>
      </template>
      <p v-if="states[machine.key]?.installed && !states[machine.key]?.enabled" class="projects-plugin-note">{{ tl('Le plugin est désactivé dans Herdr.', 'The plugin is disabled in Herdr.') }}</p>
    </div>
  </div>
  <div class="settings-group projects-plugin-settings">
    <h3>{{ tl('Réglages herdr-projects', 'herdr-projects settings') }}</h3>
    <h4 id="project-board" class="projects-board-title">{{ tl('Tableau du projet', 'Project board') }}</h4>
    <p class="projects-plugin-intro">{{ tl('Le panneau Projet lit TASKS.md : une liste par titre ##, une tâche par ligne « - [ ] titre (responsable) ». herdr-projects n’impose que le Backlog ; « À tester » et « À décider » sont une convention de wherdr, avec leurs boutons.', 'The Project panel reads TASKS.md: one list per ## heading, one task per line “- [ ] title (owner)”. herdr-projects only requires the Backlog; “To test” and “To decide” are a wherdr convention, with their own buttons.') }}</p>
    <ul class="projects-board-lists">
      <li v-for="l in boardLists" :key="l.name">
        <UIcon :name="l.icon" />
        <div>
          <strong>{{ l.name }}</strong>
          <span class="also">{{ tl('aussi', 'also') }} : {{ l.also }}</span>
          <p>{{ l.what }}</p>
        </div>
      </li>
    </ul>
    <p class="projects-plugin-note">{{ tl('Toute autre liste ## s’affiche aussi, en style neutre.', 'Any other ## list is shown too, in a neutral style.') }}</p>
    <div class="projects-plugin-actions">
      <UButton size="sm" color="neutral" variant="outline" icon="i-lucide-file-text" @click="copyTemplate">{{ tl('Copier le modèle TASKS.md', 'Copy TASKS.md template') }}</UButton>
      <UButton size="sm" color="neutral" variant="outline" icon="i-lucide-clipboard-list" @click="copyRules">{{ tl('Copier les règles pour le coordinateur', 'Copy rules for the coordinator') }}</UButton>
    </div>
  </div>
</template>
