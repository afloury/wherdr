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
// Installé depuis wherdr : rappel de recharger la config du client Herdr, jusqu'au prochain chargement.
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
    `Installer herdr-projects sur ${machine.label} ? Herdr téléchargera le plugin depuis GitHub et exécutera son installation sur cette machine.`,
    `Install herdr-projects on ${machine.label}? Herdr will download the plugin from GitHub and run its installer on this machine.`,
  ), t('Installer'), 'primary')) return
  busy.value = { ...busy.value, [machine.key]: true }
  try {
    await api('/api/plugins/projects', { machine: machine.key })
    toast(tl(`herdr-projects installé sur ${machine.label}.`, `herdr-projects installed on ${machine.label}.`))
    justInstalled.value = { ...justInstalled.value, [machine.key]: true }
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
  { icon: 'i-lucide-git-pull-request', name: tl('À relire', 'To review'), also: 'To review, Relire, Relecture, Review(s), PR(s), Pull requests, À valider', what: tl('PR que tu dois relire : « Ouvrir la PR » pour chaque lien https de la ligne, Relu envoie « ✓ Relu : … », Commenter prépare un retour.', 'Pull requests for you to review: “Open PR” for each https link in the line, Reviewed sends “✓ Reviewed: …”, Comment drafts feedback.') },
  { icon: 'i-lucide-octagon-alert', name: tl('Bloqué', 'Blocked'), also: 'Bloque, Bloquée(s), Blocked, On hold, En attente, Waiting, Stuck', what: tl('Attente extérieure : raison facultative « — bloqué par : … » ; Débloquer envoie une demande, Préciser prépare un message.', 'External dependency: optional “— blocked by: …” reason; Unblock sends a request, Clarify prepares a message.') },
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
const hideEmptyOn = projectHideEmpty
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
      <div v-if="justInstalled[machine.key]" class="plugin-input-note reload projects-plugin-reload">
        <UIcon name="i-lucide-refresh-cw" />
        <div>
          <strong>{{ tl('Recharge la config du client Herdr', 'Reload the Herdr client config') }}</strong>
          <p>{{ tl('Dans le terminal Herdr : ', 'In the Herdr terminal: ') }}<kbd>prefix</kbd> + <kbd>Shift</kbd> + <kbd>R</kbd>. {{ tl('Puis lance « Set up the sidebar… » depuis le menu d’un agent pour installer la barre latérale et les hooks.', 'Then run “Set up the sidebar…” from an agent’s menu to install the sidebar and the hooks.') }}</p>
        </div>
      </div>
      <p v-if="states[machine.key]?.installed && !states[machine.key]?.enabled" class="projects-plugin-note">{{ tl('Le plugin est désactivé dans Herdr.', 'The plugin is disabled in Herdr.') }}</p>
    </div>
  </div>
  <div class="settings-group projects-plugin-settings">
    <h3>{{ tl('Réglages herdr-projects', 'herdr-projects settings') }}</h3>
    <h4 id="project-board" class="projects-board-title">{{ tl('Tableau du projet', 'Project board') }}</h4>
    <p class="projects-plugin-intro">{{ tl('Le panneau Projet lit TASKS.md : une liste par titre ##, une tâche par ligne « - [ ] titre (responsable) », le responsable étant lu mais pas affiché. herdr-projects n’impose que le Backlog ; « À tester », « À décider », « À relire » et « Bloqué » sont une convention de wherdr, avec leurs boutons.', 'The Project panel reads TASKS.md: one list per ## heading, one task per line “- [ ] title (owner)”, the owner being read but not shown. herdr-projects only requires the Backlog; “To test”, “To decide”, “To review” and “Blocked” are a wherdr convention, with their own buttons.') }}</p>
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
    <p class="projects-plugin-note">{{ tl('Seule décoration des tâches : les badges que le coordinateur choisit, n’importe où dans la ligne. « [b:couleur(texte)] », ou « [b:couleur(texte)](cible) » pour un badge cliquable ↗ : cible = lien https:// (nouvel onglet) ou ID de thread t-0140 (ouvre son onglet). Couleur : red, orange, amber, green, teal, blue, violet, pink, gray (suivent le thème), un hex #rgb / #rrggbb, ou rien (neutre) ; 24 caractères affichés au plus. Une URL dans le texte devient un lien simple. Les règles du coordinateur ci-dessous lui disent d’en user de lui-même quand c’est utile.', 'The only task decoration: badges the coordinator chooses, anywhere in the line. “[b:color(text)]”, or “[b:color(text)](target)” for a clickable ↗ badge: target = an https:// link (new tab) or a thread ID t-0140 (opens its tab). Color: red, orange, amber, green, teal, blue, violet, pink, gray (theme-aware), a #rgb / #rrggbb hex, or nothing (neutral); at most 24 characters shown. A URL in the text becomes a plain link. The coordinator rules below tell it to use them on its own when useful.') }}</p>
    <pre class="projects-board-example"><code>- [ ] {{ tl('Bouton Stop sur iPhone', 'Stop button on iPhone') }} [b:red(bug)] [b:gray(t-0140)](t-0140) [b:blue(PR #12)](https://github.com/owner/repo/pull/12) (me)</code></pre>
    <p class="projects-plugin-note">{{ tl('Toute autre liste ## s’affiche aussi, en style neutre.', 'Any other ## list is shown too, in a neutral style.') }}</p>
    <p class="projects-plugin-note">{{ tl('Les listes présentes dans TASKS.md sont les listes actives : pour en ajouter ou en retirer une, demande-le au coordinateur (pas de réglage dans wherdr).', 'The lists in TASKS.md are the active lists: to add or remove one, ask the coordinator (there is no setting in wherdr).') }}</p>
    <label class="settings-toggle">
      <span><b>{{ tl('Masquer les listes vides', 'Hide empty lists') }}</b><small>{{ tl('Afficher une liste du panneau Projet seulement si elle a des éléments (En cours et Fait compris). Réglage propre à cet appareil.', 'Show a Project panel list only when it has items (In progress and Done included). Setting specific to this device.') }}</small></span>
      <USwitch v-model="hideEmptyOn" color="success" size="xl" />
    </label>
    <div class="projects-plugin-actions">
      <UButton size="sm" color="neutral" variant="outline" icon="i-lucide-file-text" @click="copyTemplate">{{ tl('Copier le modèle TASKS.md', 'Copy TASKS.md template') }}</UButton>
      <UButton size="sm" color="neutral" variant="outline" icon="i-lucide-clipboard-list" @click="copyRules">{{ tl('Copier les règles pour le coordinateur', 'Copy rules for the coordinator') }}</UButton>
    </div>
  </div>
</template>
