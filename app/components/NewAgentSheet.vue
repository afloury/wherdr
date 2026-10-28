<script setup lang="ts">
// New agent (Claude, Codex), terminal or project coordinator: folder (browser +
// recent ones), separate worktree if it is a Git repository, conversation resume,
// first message (queued on the server until the agent is ready).
// Several machines: choice of the machine, its folders and recent ones.
// "Split" (`newSplit`) or "New tab" (`newTabSpace`): the agent
// starts in a pane that does not exist yet, only created on clicking
// "Launch", on the machine of the split pane or of the space; no choice of
// machine nor worktree.
// On the phone it opens full screen, Launch pinned at the bottom.
import type { MachineConfig } from '#shared/types'
import { machineOf } from '#shared/ids'
import { splitPreview } from '#shared/layout'
import { selectedAgentKind, visibleAgentKinds } from '~/utils/agentChoices'
import { type NewPanePlace, launchInNewPane } from '~/utils/paneLaunch'
import type { ProjectFolder } from '#shared/projectFolder'

const open = newAgentOpen
const kind = ref<string>('')
const dir = ref<string | null>(null)
const worktree = ref(false)
const branch = ref('')
const resume = ref(false)
const prompt = ref('')
// Typed as the user wants it (spaces too): the new space's name, or the
// pane's in an existing space. The server derives Herdr's agent id from it.
const name = ref('')
const error = ref<string | null>(null)
const launching = ref(false)
const isGit = ref(false)
const browsing = ref(false)

const kinds = computed(() => visibleAgentKinds(machineCfg.value?.kinds || appConfig.value.kinds || [], hiddenAgents.value))
const coordinator = ref(false)
const links = useBoardLinks()
const repoPick = ref('')
const repos = computed(() => links.value.find(m => m.machine === machine.value)?.repos || [])
// A known repo's name is its coordinator key; its root would name another coordinator.
const repoItems = computed(() => [...repos.value.map(r => ({ label: r.repo, value: r.repo })), { label: tl('Other repository…', 'Autre dépôt…'), value: '__other' }])
// Another folder: what its machine says of it (on the board by name, to be
// added, missing, not Git), asked again as the folder or the machine changes.
const folderInfo = ref<ProjectFolder | null>(null)
const folderChecking = ref(false)
const folderError = ref('')
let folderAsk = 0
// The coordinator's key: a known repo's name ('' while a folder is not usable).
const project = computed(() => (repoPick.value === '__other'
  ? (folderInfo.value?.state === 'known' || folderInfo.value?.state === 'new' ? folderInfo.value.repo : '')
  : repoPick.value))
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
watch(machine, () => { repoPick.value = '' })
watch(() => [coordinator.value && repoPick.value === '__other' ? dir.value : null, machine.value] as const, async ([d, mk]) => {
  const n = ++folderAsk
  folderInfo.value = null
  folderError.value = ''
  folderChecking.value = false
  if (!d) return
  folderChecking.value = true
  try {
    const r = await api<ProjectFolder>(`/api/tasks/project?${new URLSearchParams({ machine: mk, folder: d })}`)
    if (n === folderAsk) folderInfo.value = r
  } catch (e) { if (n === folderAsk) folderError.value = (e as Error).message }
  finally { if (n === folderAsk) folderChecking.value = false }
})
const machineCfg = computed(() => (machineList.value ? machineList.value.find(m => m.key === machine.value) : undefined))
const online = machineOnline
const home = computed(() => (machineCfg.value ? machineCfg.value.home : appConfig.value.home))
const recents = computed(() => (machineCfg.value ? machineCfg.value.dirs : appConfig.value.dirs) || [])
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
  coordinator.value = false
  repoPick.value = ''
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
  coordinator.value = false
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
    if (gitFor === d) {
      isGit.value = r.git
    }
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
    const why = t(r.error)
    error.value = why
    toast(isTab ? tl(`Tab not created: ${why}`, `Onglet non créé : ${why}`) : tl(`Pane not created: ${why}`, `Pane non créé : ${why}`), true)
    return
  }
  if (isTab && r.tabId) rememberNewTab(place.workspaceId, r.tabId)
  const splitTab = target.value?.tab
  resetForm()
  newAgentOpen.value = false
  if (r.stage === 'agent') {
    const what = isTab ? tl('Tab created', 'Onglet créé') : tl('Pane created', 'Pane créé')
    toast(shell.value || !kind.value
      ? tl(`${what}, but the command did not start: ${t(r.error)}`, `${what}, mais la commande n’a pas démarré : ${t(r.error)}`)
      : tl(`${what}, but ${kindLabel(kind.value)} did not start: ${r.error}`, `${what}, mais ${kindLabel(kind.value)} n’a pas démarré : ${r.error}`), true)
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
    if (coordinator.value) {
      if (!project.value) return
      let repo = project.value
      // Not on the board yet: added first, so its first message starts it.
      if (repoPick.value === '__other' && folderInfo.value?.state === 'new') {
        repo = (await api<{ repo: string }>('/api/tasks/project', { machine: machine.value, folder: dir.value })).repo
        refreshBoardLinks()
      }
      newAgentOpen.value = false
      await navigateTo({ path: '/board', query: { machine: machine.value, coordinator: repo } })
      return
    }
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
  <AppSheet v-model:open="open" :title="newTabSpace ? t('Start in a new tab') : newSplit ? t('Start in a new pane') : coordinator ? tl('Project coordinator', 'Coordinateur de projet') : t(shell ? 'New terminal' : 'New agent')" tall screen>
    <div v-if="!browsing" class="sheet-form">
      <div v-if="newSplit || newTabSpace" class="into-pane">
        <TabMap v-if="splitMap && targetTab" :layout="splitMap" :panes="targetTab.panes" :current="NEW_PANE" />
        <span v-else class="tabmap" aria-hidden="true"><i class="cur" style="inset: 0" /></span>
        <span>
          <b>{{ newTabSpace ? t('New tab') : [t('New pane'), targetTab ? `${t('Tab')} ${tabTitle(targetTab)}` : null].filter(Boolean).join(' · ') }}</b>
          <small>{{ [targetWs?.label, newSplit ? (newSplit.direction === 'right' ? tl('Split right', 'Division à droite') : tl('Split down', 'Division en bas')) : null, machineList ? machineName(machine) : null].filter(Boolean).join(' · ') }}</small>
        </span>
      </div>
      <template v-if="newTabSpace">
        <label class="field-label" for="newTabName">{{ t('Tab name') }} <span class="muted">{{ t('(optional)') }}</span></label>
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
      <div class="segmented agent-kinds" :style="{ '--segment-count': kinds.length + (fixedMachine ? 0 : 1) }">
        <button v-for="k in kinds" :key="k" type="button" :class="{ on: !coordinator && k === kind }" :data-kind="k" @click="pickKind(k)">
          <AgentAvatar :agent="k === 'shell' ? null : k" /><span>{{ k === 'shell' ? 'Terminal' : kindLabel(k) }}</span>
        </button>
        <button v-if="!fixedMachine" type="button" :class="{ on: coordinator }" data-kind="coordinator" @click="coordinator = true; repoPick ||= repoItems[0]?.value || '__other'">
          <UIcon name="i-lucide-message-square-text" /><span>{{ tl('Coordinator', 'Coordinateur') }}</span>
        </button>
      </div>

      <template v-if="coordinator">
        <label class="field-label" for="coordinator-repo">{{ tl('Repository', 'Dépôt') }}</label>
        <USelect id="coordinator-repo" v-model="repoPick" :items="repoItems" size="xl" class="w-full" :ui="{ content: 'z-[30]' }" />
        <template v-if="repoPick === '__other'">
          <label class="field-label">{{ t('Folder') }}</label>
          <DirField :key="machine" v-model="dir" :recents="recents" @browse="browsing = true" />
          <p v-if="folderChecking" class="muted project-folder" data-testid="project-folder-state" data-state="checking">{{ tl('Checking the folder…', 'Vérification du dossier…') }}</p>
          <p v-else-if="folderError" class="form-error project-folder" data-testid="project-folder-state" data-state="error">{{ folderError }}</p>
          <p v-else-if="folderInfo?.state === 'known'" class="project-folder" data-testid="project-folder-state" data-state="known">
            <span class="project-folder-tag">{{ tl('On the board', 'Sur le board') }}</span>
            {{ tl('Its project is', 'Son projet est') }} <code>{{ folderInfo.repo }}</code>{{ tl(': this opens its coordinator.', ' : ceci ouvre son coordinateur.') }}
          </p>
          <p v-else-if="folderInfo?.state === 'new'" class="project-folder" data-testid="project-folder-state" data-state="new">
            <span class="project-folder-tag new">{{ tl('New project', 'Nouveau projet') }}</span>
            {{ tl('Added to the board as', 'Ajouté au board sous le nom') }} <code>{{ folderInfo.repo }}</code>{{ tl(', with no task, when you open the conversation.', ', sans aucune tâche, à l’ouverture de la conversation.') }}
          </p>
          <p v-else-if="folderInfo" class="form-error project-folder" data-testid="project-folder-state" :data-state="folderInfo.state">
            {{ folderInfo.state === 'missing' ? tl('This folder does not exist on this machine.', 'Ce dossier n’existe pas sur cette machine.') : tl('This folder is not a Git repository: a project coordinator needs one.', 'Ce dossier n’est pas un dépôt Git : un coordinateur de projet en demande un.') }}
          </p>
        </template>
        <p class="muted">{{ tl('Open this project’s conversation. Your first message starts its coordinator.', 'Ouvrir la conversation du projet. Ton premier message lance son coordinateur.') }}</p>
      </template>
      <template v-else>
        <label class="field-label">{{ t('Folder') }}</label>
        <DirField :key="machine" v-model="dir" :recents="recents" @browse="browsing = true" />

        <label v-if="isGit && !fixedMachine" class="toggle-row">
          <span><b>{{ t('Separate worktree') }}</b><small>{{ t('new branch, leaves the original folder untouched') }}</small></span>
          <USwitch v-model="worktree" color="success" size="xl" />
        </label>
        <div v-if="isGit && worktree && !fixedMachine">
          <label class="field-label" for="newBranch">{{ t('Branch') }} <span class="muted">{{ t('(optional)') }}</span></label>
          <UInput
            id="newBranch" ref="branchInput" v-model="branch" size="xl" class="w-full mono" autocapitalize="none" autocorrect="off"
            :spellcheck="false" placeholder="claude-a1b2" maxlength="80"
          />
        </div>

        <label v-if="canResume" class="toggle-row">
          <span><b>{{ t('Resume the last conversation') }}</b><small>{{ t('for this agent in this folder') }}</small></span>
          <USwitch v-model="resume" color="success" size="xl" />
        </label>

        <label class="field-label" for="newPrompt">{{ t(shell ? 'Command to run' : 'First message') }} <span class="muted">{{ t('(optional)') }}</span></label>
        <UTextarea
          id="newPrompt" v-model="prompt" :rows="2" autoresize size="xl" class="w-full" :class="{ mono: shell }"
          :placeholder="t(shell ? 'E.g. npm run dev' : 'E.g. Summarize the project TODOs')"
        />

        <template v-if="!shell">
          <label class="field-label" for="newName">{{ t('Name') }} <span class="muted">{{ t('(optional)') }}</span></label>
          <UInput
            id="newName" v-model="name" size="xl" class="w-full" autocapitalize="none" autocorrect="off"
            :spellcheck="false" placeholder="reviewer" maxlength="60"
          />
        </template>
      </template>
    </div>

    <DirBrowser v-else :start="dir" :machine="machine" @choose="chooseDir" @cancel="browsing = false" />

    <template #footer>
      <div v-if="!browsing" class="sheet-form">
        <p v-if="error" class="form-error">{{ t(error) }}</p>
        <UButton block size="xl" color="primary" variant="solid" class="launch-btn hw-cta" icon="i-lucide-play" :loading="launching" :disabled="coordinator ? !project : !kind" @click="launch">
          {{ coordinator ? (repoPick === '__other' && folderInfo?.state === 'new' ? tl('Add and open conversation', 'Ajouter et ouvrir la conversation') : tl('Open conversation', 'Ouvrir la conversation')) : launching ? t('Starting…') : t('Launch') }}
        </UButton>
      </div>
    </template>
  </AppSheet>
</template>
