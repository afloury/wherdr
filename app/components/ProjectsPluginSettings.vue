<script setup lang="ts">
import type { MachineConfig } from '#shared/types'
import { PROJECTS_COMMAND } from '#shared/projectsPlugin'
import { coordinatorRules, tasksTemplate } from '#shared/projectBoard'
import { LIMITS_FILE, MAX_THREAD_LIMIT, type MachineSlots } from '#shared/threadLimits'

const props = defineProps<{ machines: MachineConfig[] }>()
type PluginState = { installed: boolean, enabled: boolean, version: string | null, installable: boolean }
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
    `Install herdr-projects on ${machine.label}? Herdr will download the plugin from GitHub and run its installer on this machine.`,
    `Installer herdr-projects sur ${machine.label} ? Herdr téléchargera le plugin depuis GitHub et exécutera son installation sur cette machine.`,
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

async function copy(machine: MachineConfig) {
  haptic()
  try {
    await navigator.clipboard.writeText(PROJECTS_COMMAND)
    toast(tl(`Command copied: paste it into a terminal on ${machine.label}.`, `Commande copiée : colle-la dans un terminal de ${machine.label}.`))
  } catch { toast(t('Copy failed'), true) }
}

// Project board: lists recognized in TASKS.md (synonyms of KINDS,
// shared/projectBoard.ts) and texts to copy.
const boardLists = computed(() => [
  { icon: 'i-lucide-flask-conical', name: tl('To test', 'À tester'), also: 'To test, Testing, À vérifier', what: tl('What you must check: Confirm, Problem, Question.', 'Ce que tu dois vérifier : Confirmer, Problème, Question.') },
  { icon: 'i-lucide-signpost', name: tl('To decide', 'À décider'), also: 'To decide, Décisions, Questions', what: tl('Questions only you can unblock: Question, Answer.', 'Questions que toi seul peux trancher : Question, Répondre.') },
  { icon: 'i-lucide-git-pull-request', name: tl('To review', 'À relire'), also: 'To review, Relire, Relecture, Review(s), PR(s), Pull requests, À valider', what: tl('Pull requests for you to review: Reviewed sends “✓ Reviewed: …”, Comment drafts feedback.', 'PR que tu dois relire : Relu envoie « ✓ Relu : … », Commenter prépare un retour.') },
  { icon: 'i-lucide-activity', name: tl('In progress', 'En cours'), also: 'In progress, Doing, WIP', what: tl('What threads are really doing: open threads, live.', 'Ce que les threads font vraiment : threads ouverts, en direct.') },
  { icon: 'i-lucide-list-ordered', name: tl('In queue', 'En file'), also: 'In queue, Queue, Queued, Up next, File d’attente', what: tl('Decided: the coordinator launches the first task as soon as a thread slot frees, in list order. Move up / down, Launch now, Clarify, Remove from queue (back to To do); the header shows the thread slots in use.', 'Décidé : le coordinateur lance la première tâche dès qu’une place de thread se libère, dans l’ordre de la liste. Monter / Descendre, Lancer maintenant, Préciser, Retirer de la file (retour en À faire) ; l’en-tête montre les places de thread occupées.') },
  { icon: 'i-lucide-octagon-alert', name: tl('Blocked', 'Bloqué'), also: 'Bloque, Bloquée(s), Blocked, On hold, En attente, Waiting, Stuck', what: tl('Waiting for someone or something external: optional “— blocked by: …” reason; Unblock sends a request, Clarify prepares a message.', 'Attente de quelqu’un ou de quelque chose d’extérieur : raison facultative « — bloqué par : … » ; Débloquer envoie une demande, Préciser prépare un message.') },
  { icon: 'i-lucide-list-todo', name: tl('To do', 'À faire'), also: 'To do, Todo, Next, Soon, Prochainement', what: tl('To do soon, in your priority order; never launched automatically. Move up / down, Queue it, Launch now (a thread if a slot is free, otherwise first in the queue), Clarify, Back to backlog.', 'À faire bientôt, dans ton ordre de priorité ; jamais lancé automatiquement. Monter / Descendre, Mettre en file, Lancer maintenant (un thread si une place est libre, sinon en tête de file), Préciser, Remettre au backlog.') },
  { icon: 'i-lucide-archive', name: 'Backlog', also: 'Later, Plus tard, Idées, Ideas, Someday', what: tl('Everything else. Launch sends the task to the coordinator; Clarify prepares a message.', 'Tout le reste. Lancer envoie la tâche au coordinateur ; Préciser prépare un message.') },
  { icon: 'i-lucide-circle-check', name: tl('Done', 'Fait'), also: 'Done, Terminé, Finished', what: tl('Filled by resolved threads.', 'Remplie par les threads clôturés.') },
])
async function copyText(text: string, done: string) {
  haptic()
  try {
    await navigator.clipboard.writeText(text)
    toast(done)
  } catch { toast(t('Copy failed'), true) }
}
const lang = () => (language === 'en' ? 'en' : 'fr')
const hideEmptyOn = projectHideEmpty
const copyTemplate = () => copyText(tasksTemplate(lang()), tl('Template copied: paste it into the project’s TASKS.md.', 'Modèle copié : colle-le dans TASKS.md du projet.'))
// Global thread limit per machine (all projects), saved on the server.
const slots = ref<Record<string, MachineSlots>>({})
const limitError = ref('')
const pendingLimits = new Map<string, ReturnType<typeof setTimeout>>()
function takeSlots(list: MachineSlots[]) { slots.value = Object.fromEntries(list.map(m => [m.key, m])) }
async function loadSlots() {
  try {
    takeSlots((await api<{ machines: MachineSlots[] }>('/api/plugins/thread-limits')).machines)
    limitError.value = ''
  } catch (e) { limitError.value = (e as Error).message }
}
loadSlots()
// −: down to 1, then no limit; +: from no limit, starts at the open threads (at least 1).
function stepLimit(machine: MachineConfig, step: -1 | 1) {
  haptic()
  const cur = slots.value[machine.key]
  const max = cur?.max ?? null
  const next = max === null ? (step > 0 ? Math.max(1, cur?.open || 0) : null) : (max + step < 1 ? null : Math.min(MAX_THREAD_LIMIT, max + step))
  if (next === max) return
  const open = cur?.open || 0
  slots.value = { ...slots.value, [machine.key]: { key: machine.key, label: machine.label, open, threads: cur?.threads || [], max: next, free: next === null ? null : Math.max(0, next - open) } }
  clearTimeout(pendingLimits.get(machine.key))
  pendingLimits.set(machine.key, setTimeout(async () => {
    pendingLimits.delete(machine.key)
    try { takeSlots((await api<{ machines: MachineSlots[] }>('/api/plugins/thread-limits', { machine: machine.key, max: next })).machines) }
    catch (e) { toast((e as Error).message, true); loadSlots() }
  }, 450))
}
const openLabel = (n: number) => tl(`${n} open thread${n === 1 ? '' : 's'} · all projects`, `${n} thread${n > 1 ? 's' : ''} ouvert${n > 1 ? 's' : ''} · tous projets`)
const copyRules = () => copyText(coordinatorRules(lang()), tl('Rules copied: paste them to the coordinator.', 'Règles copiées : colle-les au coordinateur.'))
</script>

<template>
  <div class="settings-group projects-plugin">
    <h3>herdr-projects</h3>
    <p class="projects-plugin-intro">{{ tl('herdr-projects groups coordinators and their threads by project, adding the Project panel and worktree repositories in wherdr. The plugin is optional: agents and other wherdr features still work without it.', 'herdr-projects regroupe les coordinateurs et leurs threads par projet, avec un panneau Projet et les dépôts de worktrees dans wherdr. Le plugin est facultatif : les agents et les autres fonctions de wherdr restent utilisables sans lui.') }}</p>
    <a class="projects-plugin-link" href="https://github.com/eliasstravik/herdr-projects" target="_blank" rel="noopener noreferrer">
      {{ tl('View plugin repository', 'Voir le dépôt du plugin') }} <UIcon name="i-lucide-external-link" />
    </a>
    <div v-for="machine in machines" :key="machine.key" class="projects-plugin-machine">
      <div class="projects-plugin-head">
        <strong>{{ machine.label }}</strong>
        <span v-if="!machine.online">{{ tl('Offline', 'Hors ligne') }}</span>
        <span v-else-if="loading[machine.key] && !states[machine.key]">{{ tl('Checking…', 'Vérification…') }}</span>
        <span v-else-if="errors[machine.key]">{{ tl('Status unavailable', 'État indisponible') }}</span>
        <span v-else-if="states[machine.key]?.installed" class="installed">{{ tl('Installed', 'Installé') }}{{ states[machine.key]?.version ? ` · v${states[machine.key]?.version}` : '' }}</span>
        <span v-else>{{ tl('Not installed', 'Non installé') }}</span>
      </div>
      <p v-if="machine.online && errors[machine.key]" class="projects-plugin-note">{{ errors[machine.key] }}</p>
      <template v-if="machine.online && states[machine.key] && !states[machine.key]?.installed && !errors[machine.key]">
        <div class="projects-plugin-actions">
          <UButton v-if="states[machine.key]?.installable" size="sm" color="primary" icon="i-lucide-download" :loading="busy[machine.key]" @click="install(machine)">{{ tl('Install herdr-projects', 'Installer herdr-projects') }}</UButton>
          <UButton size="sm" color="neutral" variant="outline" icon="i-lucide-copy" @click="copy(machine)">{{ t('Copy command') }}</UButton>
        </div>
        <p v-if="!states[machine.key]?.installable" class="projects-plugin-note">{{ tl('Direct installation is unavailable here: run the command on this machine.', 'Installation directe indisponible ici : lance la commande sur cette machine.') }}</p>
      </template>
      <div v-if="justInstalled[machine.key]" class="plugin-input-note reload projects-plugin-reload">
        <UIcon name="i-lucide-refresh-cw" />
        <div>
          <strong>{{ tl('Reload the Herdr client config', 'Recharge la config du client Herdr') }}</strong>
          <p>{{ tl('In the Herdr terminal: ', 'Dans le terminal Herdr : ') }}<kbd>prefix</kbd> + <kbd>Shift</kbd> + <kbd>R</kbd>. {{ tl('Then run “Set up the sidebar…” from an agent’s menu to install the sidebar and the hooks.', 'Puis lance « Set up the sidebar… » depuis le menu d’un agent pour installer la barre latérale et les hooks.') }}</p>
        </div>
      </div>
      <p v-if="states[machine.key]?.installed && !states[machine.key]?.enabled" class="projects-plugin-note">{{ tl('The plugin is disabled in Herdr.', 'Le plugin est désactivé dans Herdr.') }}</p>
    </div>
  </div>
  <div class="settings-group projects-plugin-settings">
    <h3>{{ tl('herdr-projects settings', 'Réglages herdr-projects') }}</h3>
    <h4 id="project-board" class="projects-board-title">{{ tl('Project board', 'Tableau du projet') }}</h4>
    <p class="projects-plugin-intro">{{ tl('The Project panel reads TASKS.md: one list per ## heading, one task per line “- [ ] title (owner)”, the owner being read but not shown. Every list is optional: each project uses the ones chosen with its coordinator (a small project may only need Backlog, In progress and Done). The panel shows the lists present, always in the order below, each with its own buttons; every button sends a message to the coordinator, which edits TASKS.md.', 'Le panneau Projet lit TASKS.md : une liste par titre ##, une tâche par ligne « - [ ] titre (responsable) », le responsable étant lu mais pas affiché. Toutes les listes sont facultatives : chaque projet utilise celles choisies avec son coordinateur (un petit projet peut se contenter de Backlog, En cours et Fait). Le panneau affiche les listes présentes, toujours dans l’ordre ci-dessous, chacune avec ses boutons ; chaque bouton envoie un message au coordinateur, qui modifie TASKS.md.') }}</p>
    <ul class="projects-board-lists">
      <li v-for="l in boardLists" :key="l.name">
        <UIcon :name="l.icon" />
        <div>
          <strong>{{ l.name }}</strong>
          <span class="also">{{ tl('also', 'aussi') }} : {{ l.also }}</span>
          <p>{{ l.what }}</p>
        </div>
      </li>
    </ul>
    <p class="projects-plugin-note">{{ tl('The only task decoration: badges the coordinator chooses, anywhere in the line. “[b:color(text)]”, or “[b:color(text)](target)” for a clickable ↗ badge: target = an https:// link (new tab) or a thread ID t-0140 (opens its tab). Color: red, orange, amber, green, teal, blue, violet, pink, gray (theme-aware), a #rgb / #rrggbb hex, or nothing (neutral); at most 24 characters shown. A URL in the text becomes a plain link. The coordinator rules below tell it to use them on its own when useful.', 'Seule décoration des tâches : les badges que le coordinateur choisit, n’importe où dans la ligne. « [b:couleur(texte)] », ou « [b:couleur(texte)](cible) » pour un badge cliquable ↗ : cible = lien https:// (nouvel onglet) ou ID de thread t-0140 (ouvre son onglet). Couleur : red, orange, amber, green, teal, blue, violet, pink, gray (suivent le thème), un hex #rgb / #rrggbb, ou rien (neutre) ; 24 caractères affichés au plus. Une URL dans le texte devient un lien simple. Les règles du coordinateur ci-dessous lui disent d’en user de lui-même quand c’est utile.') }}</p>
    <pre class="projects-board-example"><code>- [ ] {{ tl('Stop button on iPhone', 'Bouton Stop sur iPhone') }} [b:red(bug)] [b:gray(t-0140)](t-0140) [b:blue(PR #12)](https://github.com/owner/repo/pull/12) (me)</code></pre>
    <p class="projects-plugin-note">{{ tl('Any other ## list is shown too, in a neutral style, after Backlog.', 'Toute autre liste ## s’affiche aussi, en style neutre, après Backlog.') }}</p>
    <p class="projects-plugin-note">{{ tl('The lists in TASKS.md are the active lists: to add or remove one, ask the coordinator (there is no setting in wherdr).', 'Les listes présentes dans TASKS.md sont les listes actives : pour en ajouter ou en retirer une, demande-le au coordinateur (pas de réglage dans wherdr).') }}</p>
    <label class="settings-toggle">
      <span><b>{{ tl('Hide empty lists', 'Masquer les listes vides') }}</b><small>{{ tl('Show a Project panel list only when it has items (In progress and Done included). Setting specific to this device.', 'Afficher une liste du panneau Projet seulement si elle a des éléments (En cours et Fait compris). Réglage propre à cet appareil.') }}</small></span>
      <USwitch v-model="hideEmptyOn" color="success" size="xl" />
    </label>
    <h4 id="thread-limits" class="projects-board-title spaced">{{ tl('Max threads per machine', 'Threads max par machine') }}</h4>
    <p class="projects-plugin-intro">{{ tl('herdr-projects limits threads per project (max_parallel_threads in PROJECT.md). This limit counts the open threads of every project on a machine. — = no global limit.', 'herdr-projects limite les threads par projet (max_parallel_threads dans PROJECT.md). Cette limite compte les threads ouverts de tous les projets d’une machine. — = pas de limite globale.') }}</p>
    <div class="thread-limits">
      <div v-for="machine in machines" :key="machine.key" class="settings-stepper thread-limit">
        <span><b>{{ machine.label }}</b><small>{{ openLabel(slots[machine.key]?.open || 0) }}</small></span>
        <div>
          <button type="button" :aria-label="tl(`Lower the limit of ${machine.label}`, `Baisser la limite de ${machine.label}`)" :disabled="slots[machine.key]?.max == null" @click="stepLimit(machine, -1)">−</button>
          <output :class="{ full: slots[machine.key]?.max != null && (slots[machine.key]?.free ?? 1) === 0 }">{{ slots[machine.key]?.max ?? '—' }}</output>
          <button type="button" :aria-label="tl(`Raise the limit of ${machine.label}`, `Monter la limite de ${machine.label}`)" :disabled="(slots[machine.key]?.max ?? 0) >= MAX_THREAD_LIMIT" @click="stepLimit(machine, 1)">+</button>
        </div>
      </div>
    </div>
    <p v-if="limitError" class="projects-plugin-note">{{ limitError }}</p>
    <p class="projects-plugin-note">{{ tl(`wherdr writes ${LIMITS_FILE} in each herdr-projects folder where a coordinator runs, refreshed on every change: the coordinator rules below tell it to check the machine before starting a thread (fallback: herdr-projects overview).`, `wherdr écrit ${LIMITS_FILE} dans chaque dossier herdr-projects où tourne un coordinateur, à chaque changement : les règles du coordinateur ci-dessous lui disent de vérifier la machine avant de lancer un thread (sinon : herdr-projects overview).`) }}</p>
    <div class="projects-plugin-actions">
      <UButton size="sm" color="neutral" variant="outline" icon="i-lucide-file-text" @click="copyTemplate">{{ tl('Copy TASKS.md template', 'Copier le modèle TASKS.md') }}</UButton>
      <UButton size="sm" color="neutral" variant="outline" icon="i-lucide-clipboard-list" @click="copyRules">{{ tl('Copy rules for the coordinator', 'Copier les règles pour le coordinateur') }}</UButton>
    </div>
  </div>
</template>
