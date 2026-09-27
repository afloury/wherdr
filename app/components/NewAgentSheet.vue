<script setup lang="ts">
// Nouvel agent (Claude, Codex) ou nouveau terminal : dossier (navigateur +
// récents), worktree séparé si c'est un dépôt Git, reprise de conversation,
// premier message (mis en attente côté serveur jusqu'à ce que l'agent soit prêt).
// Plusieurs machines : choix de la machine, dossiers et récents de celle-ci.
// « Diviser » (`newSplit`) ou « Nouvel onglet » (`newTabSpace`) : l'agent
// démarre dans un pane qui n'existe pas encore, créé seulement au clic sur
// « Lancer », sur la machine du pane divisé ou de l'espace ; ni choix de
// machine ni worktree.
import type { DirListing, MachineConfig } from '#shared/types'
import { machineOf } from '#shared/ids'
import { splitPreview } from '#shared/layout'
import { selectedAgentKind, visibleAgentKinds } from '~/utils/agentChoices'
import { type NewPanePlace, launchInNewPane } from '~/utils/paneLaunch'

const open = newAgentOpen
const kind = ref<string>('')
const dir = ref<string | null>(null)
const worktree = ref(false)
const branch = ref('')
const resume = ref(false)
const prompt = ref('')
const name = ref('')
const error = ref<string | null>(null)
const launching = ref(false)
const isGit = ref(false)
const browsing = ref(false)

const kinds = computed(() => visibleAgentKinds(machineCfg.value?.kinds || appConfig.value.kinds || [], hiddenAgents.value))
const shell = computed(() => kind.value === 'shell')
const canResume = computed(() => kind.value === 'claude' || kind.value === 'codex')

// ------------------------------------------------------------ pane à créer
// Pane à diviser (il existe), son onglet et son espace.
const target = computed(() => (newSplit.value ? herdrState.value.panes.find(p => p.id === newSplit.value!.paneId) : undefined))
const targetTab = computed(() => (target.value ? tabOf(target.value.tab) : null))
const targetWs = computed(() => {
  const id = target.value ? target.value.workspace : newTabSpace.value
  return id ? herdrState.value.workspaces.find(w => w.id === id) : undefined
})
// Pane ou onglet à créer : machine imposée, pas de worktree.
const fixedMachine = computed(() => newSplit.value?.paneId || newTabSpace.value)
// Aperçu de la division : le nouveau pane à sa place future, en plein.
const NEW_PANE = '+new'
const splitMap = computed(() => (newSplit.value && targetTab.value
  ? splitPreview(targetTab.value.layout, newSplit.value.paneId, newSplit.value.direction, NEW_PANE)
  : null))
const tabTitle = (e: { tab: { label: string, number: number } }) => e.tab.label || String(e.tab.number)
// Nom du nouvel onglet, donné à sa création. Vide : le nom par défaut de
// Herdr (son numéro), annoncé en indication.
const tabName = ref('')
const nextTabNumber = computed(() => {
  const n = (herdrState.value.tabs || []).filter(x => x.workspace === newTabSpace.value).map(x => x.number)
  return String(n.length ? Math.max(...n) + 1 : 1)
})
// Dossier proposé pour le nouvel onglet : celui d'un pane de son espace.
const spaceCwd = (ws: string) => herdrState.value.panes.find(p => p.workspace === ws && p.cwd)?.cwd || null
watch(newAgentOpen, (o) => {
  if (o) return
  tabName.value = ''
  newSplit.value = null
  newTabSpace.value = null
})

// ------------------------------------------------------------ machine
// `machines` n'existe qu'avec plusieurs machines ; sinon tout est local, comme avant.
const machineList = computed(() => (multiMachine.value ? (appConfig.value.machines || []).filter(m => machines.value.some(s => s.key === m.key)) : null))
const machine = ref('')
const machineCfg = computed(() => (machineList.value ? machineList.value.find(m => m.key === machine.value) : undefined))
// En ligne : d'après l'état en direct (la config a pu être lue avant la connexion).
const online = (m: MachineConfig) => m.local || (machineInfo(m.key)?.status === 'online' && Boolean(m.home))
const machineState = (m: MachineConfig) => (m.local ? 'online' : machineInfo(m.key)?.status || 'offline')
const home = computed(() => (machineCfg.value ? machineCfg.value.home : appConfig.value.home))
const recents = computed(() => ((machineCfg.value ? machineCfg.value.dirs : appConfig.value.dirs) || []).slice(0, 6))
const qMachine = () => (machine.value ? `&machine=${encodeURIComponent(machine.value)}` : '')

function syncKind() {
  const list = machineList.value
  if (fixedMachine.value) machine.value = machineOf(fixedMachine.value)
  else if (list && !list.some(m => m.key === machine.value && online(m))) {
    const last = list.find(m => m.key === lastMachine.value && online(m))
    setMachine(last ? last.key : '')
  } else if (!list && machine.value) setMachine('')
  kind.value = selectedAgentKind(kind.value, kinds.value, lastKind.value)
  if (!dir.value) dir.value = recents.value[0] || home.value || '~'
}
function setMachine(k: string) {
  if (machine.value === k) return
  machine.value = k
  dir.value = recents.value[0] || home.value || '~'
  browsing.value = false
  kind.value = ''
  syncKind()
}
function pickMachine(m: MachineConfig) {
  if (!online(m)) return
  haptic()
  setMachine(m.key)
  lastMachine.value = m.key
}
watch(newAgentOpen, async (open) => {
  if (!open) return
  if (fixedMachine.value) {
    machine.value = machineOf(fixedMachine.value)
    dir.value = (newTabSpace.value ? spaceCwd(newTabSpace.value) : target.value?.cwd) || dir.value
    worktree.value = false
  }
  error.value = null
  browsing.value = false
  launching.value = false
  syncKind()
  await loadConfig()
  syncKind()
})
// Une machine se (re)connecte pendant que la feuille est ouverte : son dossier personnel.
watch(() => machines.value.map(m => `${m.key}:${m.status}`).join(','), async () => {
  if (!newAgentOpen.value || !machineList.value) return
  await loadConfig()
  syncKind()
})
watch(kinds, syncKind)
function pickKind(k: string) {
  kind.value = k
  lastKind.value = k
}

// L'option worktree n'apparaît que pour un dépôt Git.
let gitFor: string | null = null
watch(dir, async (d) => {
  if (!d) return
  gitFor = d
  isGit.value = false
  try {
    const r = await api<{ git: boolean }>(`/api/isgit?path=${encodeURIComponent(d)}${qMachine()}`)
    if (gitFor === d) isGit.value = r.git
  } catch { /* pas de dépôt */ }
  if (!isGit.value) {
    worktree.value = false
  }
}, { immediate: true })
const branchInput = ref<{ inputRef?: HTMLInputElement } | null>(null)
watch(worktree, (v) => { if (v) setTimeout(() => branchInput.value?.inputRef?.focus(), 50) })

// ------------------------------------------------------------ navigateur de dossiers
const listing = ref<DirListing | null>(null)
const listError = ref<string | null>(null)
const listLoading = ref(false)
async function browse(p: string | null) {
  listLoading.value = true
  listError.value = null
  try { listing.value = await api<DirListing>(`/api/dirs?path=${encodeURIComponent(p || '')}${qMachine()}`) }
  catch (err) { listError.value = (err as Error).message }
  finally { listLoading.value = false }
}
function openBrowser() {
  browsing.value = true
  browse(dir.value)
}
function pickDir(d: string) {
  dir.value = d
}
function chooseDir() {
  if (listing.value) dir.value = listing.value.path
  browsing.value = false
}

function resetForm() {
  worktree.value = false
  branch.value = ''
  // Un terminal créé ici doit rester visible dans la liste.
  if (shell.value) showShells.value = true
  resume.value = false
  name.value = ''
  prompt.value = ''
}

// Nouvel onglet ou division : créé maintenant (dossier choisi), puis l'agent
// dans le nouveau pane. Création refusée : on reste sur la feuille. Agent
// refusé : le pane reste avec son terminal, on y va quand même.
async function launchNew(place: NewPanePlace) {
  const r = await launchInNewPane({
    space: body => api('/api/space', body),
    agents: body => api('/api/agents', body),
  }, {
    place, cwd: dir.value,
    agent: { kind: kind.value, name: name.value.trim(), prompt: prompt.value, resume: resume.value && canResume.value },
  })
  const isTab = place.kind === 'tab'
  if (r.stage === 'create') {
    error.value = r.error
    toast(isTab ? tl(`Onglet non créé : ${r.error}`, `Tab not created: ${r.error}`) : tl(`Pane non créé : ${r.error}`, `Pane not created: ${r.error}`), true)
    return
  }
  if (isTab && r.tabId) rememberNewTab(place.workspaceId, r.tabId)
  const splitTab = target.value?.tab
  resetForm()
  newAgentOpen.value = false
  if (r.stage === 'agent') {
    const what = isTab ? tl('Onglet créé', 'Tab created') : tl('Pane créé', 'Pane created')
    toast(shell.value || !kind.value
      ? tl(`${what}, mais la commande n’a pas démarré : ${r.error}`, `${what}, but the command did not start: ${r.error}`)
      : tl(`${what}, mais ${kindLabel(kind.value)} n’a pas démarré : ${r.error}`, `${what}, but ${kindLabel(kind.value)} did not start: ${r.error}`), true)
  } else haptic()
  if (r.paneId) {
    // Division : l'onglet (plan ou côte à côte), case active = le nouveau pane.
    const tab = isTab ? null : r.tabId || splitTab
    if (tab) {
      const path = tabPath(tab)
      navigateTo({ path, query: { pane: r.paneId } }, { replace: useRouter().currentRoute.value.path === path })
    } else navigateTo(panePath(r.paneId))
  }
  loadConfig()
}

async function launch() {
  launching.value = true
  error.value = null
  try {
    if (newTabSpace.value) return await launchNew({ kind: 'tab', workspaceId: newTabSpace.value, label: tabName.value })
    if (newSplit.value) return await launchNew({ kind: 'split', ...newSplit.value })
    const r = await api<{ pane_id: string }>('/api/agents', {
      ...(machine.value ? { machine: machine.value } : {}),
      kind: kind.value,
      cwd: dir.value,
      name: name.value.trim(),
      prompt: prompt.value,
      resume: resume.value && canResume.value,
      worktree: isGit.value && worktree.value,
      branch: branch.value.trim(),
    })
    resetForm()
    newAgentOpen.value = false
    haptic()
    navigateTo(panePath(r.pane_id))
    loadConfig()
  } catch (err) {
    error.value = (err as Error).message
  } finally {
    launching.value = false
  }
}
</script>

<template>
  <AppSheet v-model:open="open" :title="newTabSpace ? t('Lancer dans un nouvel onglet') : newSplit ? t('Lancer dans un nouveau pane') : t(shell ? 'Nouveau terminal' : 'Nouvel agent')" tall>
    <div v-if="!browsing" class="sheet-form">
      <div v-if="newSplit || newTabSpace" class="into-pane">
        <TabMap v-if="splitMap && targetTab" :layout="splitMap" :panes="targetTab.panes" :current="NEW_PANE" />
        <span v-else class="tabmap" aria-hidden="true"><i class="cur" style="inset: 0" /></span>
        <span>
          <b>{{ newTabSpace ? t('Nouvel onglet') : [t('Nouveau pane'), targetTab ? `${t('Onglet')} ${tabTitle(targetTab)}` : null].filter(Boolean).join(' · ') }}</b>
          <small>{{ [targetWs?.label, newSplit ? t(newSplit.direction === 'right' ? 'Division à droite' : 'Division en bas') : null, machineList ? machineName(machine) : null].filter(Boolean).join(' · ') }}</small>
        </span>
      </div>
      <template v-if="newTabSpace">
        <label class="field-label" for="newTabName">{{ t('Nom de l’onglet') }} <span class="muted">{{ t('(optionnel)') }}</span></label>
        <UInput
          id="newTabName" v-model="tabName" size="xl" class="w-full" autocapitalize="none" autocorrect="off" enterkeyhint="done"
          :spellcheck="false" :placeholder="nextTabNumber" maxlength="60"
          @keydown.enter.prevent="($event.target as HTMLInputElement).blur()"
        />
      </template>
      <template v-else-if="machineList">
        <label class="field-label">{{ t('Machine') }}</label>
        <div class="segmented machine-seg" :style="{ '--segment-count': machineList.length }">
          <button
            v-for="m in machineList" :key="m.key" type="button" :class="[{ on: m.key === machine }, machineState(m)]"
            :disabled="!online(m)" :data-machine="m.key || 'local'" @click="pickMachine(m)"
          >
            <UIcon :name="m.local ? 'i-lucide-server' : 'i-lucide-laptop'" class="seg-icon" />
            <span>{{ m.label || t('Cette machine') }}</span>
            <i class="seg-dot" />
          </button>
        </div>
      </template>

      <label class="field-label">{{ t('Type') }}</label>
      <div class="segmented agent-kinds" :style="{ '--segment-count': kinds.length }">
        <button v-for="k in kinds" :key="k" type="button" :class="{ on: k === kind }" :data-kind="k" @click="pickKind(k)">
          <AgentAvatar :agent="k === 'shell' ? null : k" /><span>{{ k === 'shell' ? 'Terminal' : kindLabel(k) }}</span>
        </button>
      </div>

      <label class="field-label">{{ t('Dossier') }}</label>
      <button type="button" class="dir-pick" @click="openBrowser">
        <UIcon name="i-lucide-folder" />
        <span>{{ ltr(shortPath(dir)) }}</span>
        <UIcon name="i-lucide-chevron-right" class="chev" />
      </button>
      <div class="chips">
        <button v-for="d in recents" :key="d" type="button" :class="{ on: d === dir }" @click="pickDir(d)">{{ shortPath(d).split('/').pop() || '~' }}</button>
      </div>

      <label v-if="isGit && !fixedMachine" class="toggle-row">
        <span><b>{{ t('Worktree séparé') }}</b><small>{{ t('nouvelle branche, sans toucher au dossier d’origine') }}</small></span>
        <USwitch v-model="worktree" color="success" size="xl" />
      </label>
      <div v-if="isGit && worktree && !fixedMachine">
        <label class="field-label" for="newBranch">{{ t('Branche') }} <span class="muted">{{ t('(optionnel)') }}</span></label>
        <UInput
          id="newBranch" ref="branchInput" v-model="branch" size="xl" class="w-full mono" autocapitalize="none" autocorrect="off"
          :spellcheck="false" placeholder="claude-a1b2" maxlength="80"
        />
      </div>

      <label v-if="canResume" class="toggle-row">
        <span><b>{{ t('Reprendre la dernière conversation') }}</b><small>{{ t('de cet agent dans ce dossier') }}</small></span>
        <USwitch v-model="resume" color="success" size="xl" />
      </label>

      <label class="field-label" for="newPrompt">{{ t(shell ? 'Commande à lancer' : 'Premier message') }} <span class="muted">{{ t('(optionnel)') }}</span></label>
      <UTextarea
        id="newPrompt" v-model="prompt" :rows="2" autoresize size="xl" class="w-full" :class="{ mono: shell }"
        :placeholder="t(shell ? 'Ex. : npm run dev' : 'Ex. : Fais le point sur les TODO du projet')"
      />

      <template v-if="!shell">
        <label class="field-label" for="newName">{{ t('Nom') }} <span class="muted">{{ t('(optionnel)') }}</span></label>
        <UInput
          id="newName" v-model="name" size="xl" class="w-full" autocapitalize="none" autocorrect="off"
          :spellcheck="false" placeholder="reviewer" maxlength="32"
        />
      </template>

      <p v-if="error" class="form-error">{{ error }}</p>
      <UButton block size="xl" color="primary" variant="solid" class="launch-btn hw-cta" icon="i-lucide-play" :loading="launching" :disabled="!kind" @click="launch">
        {{ launching ? t('Démarrage…') : t('Lancer') }}
      </UButton>
    </div>

    <div v-else class="dir-browser">
      <div class="dir-top">
        <UButton
          size="sm" color="neutral" variant="ghost" icon="i-lucide-chevron-left" :class="{ invisible: !listing?.parent }"
          :disabled="!listing?.parent" @click="browse(listing?.parent || null)"
        >
          {{ t('Parent') }}
        </UButton>
        <span class="dir-path">{{ listing ? ltr(shortPath(listing.path)) : '' }}</span>
      </div>
      <div class="dir-list">
        <div v-if="listLoading" class="term-loading static"><span class="spinner" /></div>
        <p v-else-if="listError" class="form-error">{{ listError }}</p>
        <template v-else-if="listing">
          <button v-for="d in listing.dirs" :key="d.path" type="button" @click="browse(d.path)">
            <UIcon name="i-lucide-folder" /><span>{{ d.name }}</span><span v-if="d.git" class="git">git</span>
          </button>
          <p v-if="!listing.dirs.length" class="muted" style="padding:16px 8px">{{ t('Aucun sous-dossier.') }}</p>
        </template>
      </div>
      <div class="dir-actions">
        <UButton color="neutral" variant="ghost" size="lg" block @click="browsing = false">{{ t('Annuler') }}</UButton>
        <UButton color="primary" variant="solid" size="lg" block class="hw-cta" @click="chooseDir">{{ t('Choisir ce dossier') }}</UButton>
      </div>
    </div>
  </AppSheet>
</template>
