<script setup lang="ts">
// New agent (Claude, Codex) or new terminal: folder (browser +
// recent ones), separate worktree if it is a Git repository, conversation resume,
// first message (queued on the server until the agent is ready).
// Several machines: choice of the machine, its folders and recent ones.
// "Split" (`newSplit`) or "New tab" (`newTabSpace`): the agent
// starts in a pane that does not exist yet, only created on clicking
// "Launch", on the machine of the split pane or of the space; no choice of
// machine nor worktree.
import type { MachineConfig } from '#shared/types'
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

// ------------------------------------------------------------ pane to create
// Pane to split (it exists), its tab and its space.
const target = computed(() => (newSplit.value ? herdrState.value.panes.find(p => p.id === newSplit.value!.paneId) : undefined))
const targetTab = computed(() => (target.value ? tabOf(target.value.tab) : null))
const targetWs = computed(() => {
  const id = target.value ? target.value.workspace : newTabSpace.value
  return id ? herdrState.value.workspaces.find(w => w.id === id) : undefined
})
// Pane or tab to create: machine imposed, no worktree.
const fixedMachine = computed(() => newSplit.value?.paneId || newTabSpace.value)
// Preview of the split: the new pane in its future place, filled.
const NEW_PANE = '+new'
const splitMap = computed(() => (newSplit.value && targetTab.value
  ? splitPreview(targetTab.value.layout, newSplit.value.paneId, newSplit.value.direction, NEW_PANE)
  : null))
const tabTitle = (e: { tab: { label: string, number: number } }) => e.tab.label || String(e.tab.number)
// Name of the new tab, given at its creation. Empty: Herdr's default
// name (its number), shown as a hint.
const tabName = ref('')
const nextTabNumber = computed(() => {
  const n = (herdrState.value.tabs || []).filter(x => x.workspace === newTabSpace.value).map(x => x.number)
  return String(n.length ? Math.max(...n) + 1 : 1)
})
// Folder suggested for the new tab: that of a pane of its space.
const spaceCwd = (ws: string) => herdrState.value.panes.find(p => p.workspace === ws && p.cwd)?.cwd || null
watch(newAgentOpen, (o) => {
  if (o) return
  tabName.value = ''
  newSplit.value = null
  newTabSpace.value = null
})

// ------------------------------------------------------------ machine
// `machines` only exists with several machines; otherwise everything is local, as before.
const machineList = machineChoices
const machine = ref('')
const machineCfg = computed(() => (machineList.value ? machineList.value.find(m => m.key === machine.value) : undefined))
const online = machineOnline
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
// A machine (re)connects while the sheet is open: its home folder.
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

// The worktree option only appears for a Git repository.
let gitFor: string | null = null
watch(dir, async (d) => {
  if (!d) return
  gitFor = d
  isGit.value = false
  try {
    const r = await api<{ git: boolean }>(`/api/isgit?path=${encodeURIComponent(d)}${qMachine()}`)
    if (gitFor === d) isGit.value = r.git
  } catch { /* no repository */ }
  if (!isGit.value) {
    worktree.value = false
  }
}, { immediate: true })
const branchInput = ref<{ inputRef?: HTMLInputElement } | null>(null)
watch(worktree, (v) => { if (v) setTimeout(() => branchInput.value?.inputRef?.focus(), 50) })

// ------------------------------------------------------------ navigateur de dossiers
function chooseDir(d: string) {
  dir.value = d
  browsing.value = false
}

function resetForm() {
  worktree.value = false
  branch.value = ''
  // A terminal created here must stay visible in the list.
  if (shell.value) showShells.value = true
  resume.value = false
  name.value = ''
  prompt.value = ''
}

// New tab or split: created now (chosen folder), then the agent
// in the new pane. Creation refused: we stay on the sheet. Agent
// refused: the pane stays with its terminal, we go there anyway.
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
    // Split: the tab (plan or side by side), active cell = the new pane.
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
        <MachineChoice :machines="machineList" :model-value="machine" @pick="pickMachine" />
      </template>

      <label class="field-label">{{ t('Type') }}</label>
      <div class="segmented agent-kinds" :style="{ '--segment-count': kinds.length }">
        <button v-for="k in kinds" :key="k" type="button" :class="{ on: k === kind }" :data-kind="k" @click="pickKind(k)">
          <AgentAvatar :agent="k === 'shell' ? null : k" /><span>{{ k === 'shell' ? 'Terminal' : kindLabel(k) }}</span>
        </button>
      </div>

      <label class="field-label">{{ t('Dossier') }}</label>
      <DirField v-model="dir" :recents="recents" @browse="browsing = true" />

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

    <DirBrowser v-else :start="dir" :machine="machine" @choose="chooseDir" @cancel="browsing = false" />
  </AppSheet>
</template>
