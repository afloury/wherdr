<script setup lang="ts">
// Settings › Plugins › herdr-projects: where it stands on each machine, and
// what to do when the Board cannot read it (missing, a 0.2, older than 1.2.1).
import type { MachineConfig } from '#shared/types'
import { PROJECTS_COMMAND, PROJECTS_LAUNCHER, PROJECTS_MIN, PROJECTS_REF, PROJECTS_REPO_URL, type ProjectsStatus } from '#shared/projectsPlugin'
import { NOTIFY_SETUP } from '#shared/projectsTasks'

const props = defineProps<{ machines: MachineConfig[] }>()
type PluginState = { status: ProjectsStatus, version: string | null, installable: boolean }
const states = ref<Record<string, PluginState>>({})
const errors = ref<Record<string, string>>({})
const loading = ref<Record<string, boolean>>({})
const busy = ref<Record<string, boolean>>({})
// Installed from wherdr: reminder to reload the Herdr client config, until the next load.
const justInstalled = ref<Record<string, boolean>>({})

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
    `Install herdr-projects ${PROJECTS_MIN} on ${machine.label}? Herdr downloads the plugin from GitHub (release ${PROJECTS_REF}, a prebuilt program) and runs its installer on this machine.`,
    `Installer herdr-projects ${PROJECTS_MIN} sur ${machine.label} ? Herdr télécharge le plugin depuis GitHub (version ${PROJECTS_REF}, un programme déjà compilé) et exécute son installation sur cette machine.`,
  ), t('Install'), 'primary')) return
  busy.value = { ...busy.value, [machine.key]: true }
  try {
    await api('/api/plugins/projects', { machine: machine.key })
    toast(tl(`herdr-projects installed on ${machine.label}.`, `herdr-projects installé sur ${machine.label}.`))
    justInstalled.value = { ...justInstalled.value, [machine.key]: true }
    await refresh(machine)
  } catch (e) { toast((e as Error).message, true) }
  finally { busy.value = { ...busy.value, [machine.key]: false } }
}

// Push when a task needs you, is ready to approve, or failed: herdr-projects'
// own `board.notify` hands it to Herdr, which wherdr already relays.
const notifySetup = NOTIFY_SETUP(PROJECTS_LAUNCHER)
const anyReady = computed(() => Object.values(states.value).some(s => s.status === 'ready'))
async function copyNotify() {
  try {
    await navigator.clipboard.writeText(notifySetup)
    toast(t('Copied'))
  } catch { toast(tl('Copy failed', 'Copie impossible'), true) }
}

function statusText(s: PluginState): string {
  const v = s.version ? ` · v${s.version}` : ''
  if (s.status === 'ready') return tl('Installed', 'Installé') + v
  if (s.status === 'disabled') return tl('Disabled', 'Désactivé') + v
  if (s.status === 'old') return tl('Update needed', 'Mise à jour nécessaire') + v
  return tl('Not installed', 'Non installé')
}
</script>

<template>
  <div class="settings-group projects-plugin">
    <h3>herdr-projects</h3>
    <p class="projects-plugin-intro">{{ tl(`herdr-projects is a work board for Herdr: one list of tasks, each handed to an agent in its own space. wherdr shows its tasks on the Board, where you can add tasks, start and stop them, reply to an agent, approve finished work and write to its coordinators. It needs herdr-projects ${PROJECTS_MIN} or later; the plugin is optional.`, `herdr-projects est un tableau de travail pour Herdr : une liste de tâches, chacune confiée à un agent dans son propre space. wherdr affiche ses tâches dans le Board, où tu peux ajouter des tâches, les lancer et les arrêter, répondre à un agent, approuver un travail fini et écrire à ses coordinateurs. Il faut herdr-projects ${PROJECTS_MIN} ou plus ; le plugin est facultatif.`) }}</p>
    <a class="projects-plugin-link" :href="PROJECTS_REPO_URL" target="_blank" rel="noopener noreferrer">
      {{ tl('View plugin repository', 'Voir le dépôt du plugin') }} <UIcon name="i-lucide-external-link" />
    </a>
    <div v-for="machine in machines" :key="machine.key" class="projects-plugin-machine">
      <div class="projects-plugin-head">
        <strong>{{ machine.label }}</strong>
        <span v-if="!machine.online">{{ tl('Offline', 'Hors ligne') }}</span>
        <span v-else-if="loading[machine.key] && !states[machine.key]">{{ tl('Checking…', 'Vérification…') }}</span>
        <span v-else-if="errors[machine.key]">{{ tl('Status unavailable', 'État indisponible') }}</span>
        <span v-else-if="states[machine.key]" :class="states[machine.key]!.status">{{ statusText(states[machine.key]!) }}</span>
      </div>
      <p v-if="machine.online && errors[machine.key]" class="projects-plugin-note">{{ errors[machine.key] }}</p>
      <template v-if="machine.online && states[machine.key] && !errors[machine.key]">
        <div v-if="states[machine.key]!.status === 'missing' && states[machine.key]!.installable" class="projects-plugin-actions">
          <UButton size="sm" color="primary" icon="i-lucide-download" :loading="busy[machine.key]" @click="install(machine)">{{ tl('Install herdr-projects', 'Installer herdr-projects') }}</UButton>
        </div>
        <ProjectsUpgradeNote
          v-if="states[machine.key]!.status === 'missing' || states[machine.key]!.status === 'old'"
          :status="states[machine.key]!.status as 'missing' | 'old'" :version="states[machine.key]!.version"
        />
        <p v-if="states[machine.key]!.status === 'disabled'" class="projects-plugin-note">{{ tl('The plugin is disabled in Herdr: herdr plugin enable herdr-projects', 'Le plugin est désactivé dans Herdr : herdr plugin enable herdr-projects') }}</p>
        <p v-if="states[machine.key]!.status === 'ready'" class="projects-plugin-note">
          <NuxtLink to="/board">{{ tl('Open the Board', 'Ouvrir le Board') }}</NuxtLink>
        </p>
      </template>
      <div v-if="justInstalled[machine.key]" class="plugin-input-note reload projects-plugin-reload">
        <UIcon name="i-lucide-refresh-cw" />
        <div>
          <strong>{{ tl('Reload the Herdr client config', 'Recharge la config du client Herdr') }}</strong>
          <p>{{ tl('In the Herdr terminal: ', 'Dans le terminal Herdr : ') }}<kbd>prefix</kbd> + <kbd>Shift</kbd> + <kbd>R</kbd>. {{ tl('Then open its work board once in Herdr: it asks its first-run questions there.', 'Puis ouvre une fois son tableau dans Herdr : il y pose ses questions de premier lancement.') }}</p>
        </div>
      </div>
      <p v-if="!machine.online || errors[machine.key]" class="projects-plugin-note">{{ tl('By hand on this machine:', 'À la main sur cette machine :') }} <code>{{ PROJECTS_COMMAND }}</code></p>
    </div>
    <div v-if="anyReady" class="projects-plugin-notify">
      <strong>{{ tl('Push for the Board', 'Notifications du Board') }}</strong>
      <p class="projects-plugin-note">{{ tl('To get a push when a task needs you, is ready to approve, or failed, run this once on each machine with herdr-projects. A tap on the push opens the task.', 'Pour recevoir une notification quand une tâche a besoin de toi, est prête à approuver ou a échoué, lance ceci une fois sur chaque machine qui a herdr-projects. Toucher la notification ouvre la tâche.') }}</p>
      <div class="projects-upgrade-cmd">
        <code class="projects-plugin-command">{{ notifySetup }}</code>
        <UButton size="sm" color="neutral" variant="outline" icon="i-lucide-copy" :aria-label="t('Copy command')" @click="copyNotify" />
      </div>
    </div>
  </div>
</template>
