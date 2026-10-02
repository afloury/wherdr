<script lang="ts">
// View that set `curPane` last (shared by all instances).
let curPaneOwner: symbol | null = null
</script>

<script setup lang="ts">
// Agent view: space tabs, header, then the pane (Conversation / Terminal
// selector, blocking prompt, key bar, input bar).
// Phone: no selector, header icons (terminal `>_`, Project)
// toggle the pane's presentation. Computer: small selector in
// the header (or in the cell's, side by side).
// Pane of a tab with several panes: mini-map of the tab in the header
// (back to the plan, or side-by-side view on a computer) and, on the phone,
// left / right swipe to the neighbours (Herdr's reading order).
// `cell`: cell of the side-by-side view (computer). All cells are
// live: the conversation, or the terminal mirror (MirrorView, without ever
// resizing the real pane). Only the active cell (`active`, a click in
// a cell activates it) has the input field, and its mirror receives the keystrokes.
import type { QueuedMessage } from '#shared/types'
import type { PaneViewMode } from '~/composables/useHerdr'
import { neighborPane } from '#shared/layout'
import { prefillDraft } from '#shared/projectBoard'
import { swipeAxis, swipeOffset, swipeStep } from '~/utils/swipe'
import { cellMode, showComposer, terminalAttachment } from '~/utils/viewMode'
import { carriesFiles, dragDepth, splitDropped } from '~/utils/fileDrop'

const props = defineProps<{ paneId: string, cell?: boolean, active?: boolean, grip?: boolean }>()
const emit = defineEmits<{ activate: [] }>()
const route = useRoute()
const router = useRouter()

// Pane being viewed (no notification for it, read as soon as it finishes): the active
// cell. Only the view that set it clears it (the next view of the same pane
// may mount before the previous one unmounts).
const live = computed(() => !props.cell || Boolean(props.active))
const me = Symbol('vue agent')
watch(live, (on) => {
  if (!on) return
  curPane.value = props.paneId
  curPaneOwner = me
}, { immediate: true })
onUnmounted(() => {
  if (curPaneOwner === me) curPane.value = null
})

const pane = computed(() => herdrState.value.panes.find(p => p.id === props.paneId))
const workspace = computed(() => herdrState.value.workspaces.find(w => w.id === pane.value?.workspace))
// Several panes in the tab (cell or full screen): each pane carries its
// own name; the space name stays in the tab header.
const ownTitle = computed(() => Boolean(props.cell || (tabEnt.value && tabEnt.value.panes.length > 1)))
const headTitle = computed(() => (pane.value ? (ownTitle.value ? paneTitle(pane.value) : spaceTitle(pane.value, workspace.value)) : '—'))
const subtitle = computed(() => {
  const s = pane.value ? conversationSubtitle(pane.value, workspace.value) : ''
  return s && s !== headTitle.value ? s : ''
})
const command = computed(() => (pane.value?.command && pane.value.command !== headTitle.value && pane.value.command !== subtitle.value ? pane.value.command : ''))
const tabName = computed(() => pane.value && herdrState.value.tabs?.filter(x => x.workspace === pane.value?.workspace).length! > 1 ? pane.value.tabLabel : '')
// Tab of this pane (each conversation keeps its own): the pane's remembered
// mode if there is one, otherwise the device default on a computer, the
// conversation on the phone. A change of the default applies at once to the
// panes without an explicit choice.
const viewMode = computed<PaneViewMode>({
  get: () => paneViewMode(props.paneId),
  set: m => setPaneViewMode(props.paneId, m),
})
// State not received yet (opened from a notification): we wait to
// know whether it is an agent, so as not to open the terminal for nothing.
// Cell: the pane's remembered mode (conversation or terminal mirror), whether the
// cell has the focus or not; the focus only changes the border and the input.
const mode = computed<PaneViewMode | 'mirror' | null>(() => {
  const p = pane.value
  if (!p) return null
  if (props.cell) return cellMode({ chat: hasChat(p), viewMode: viewMode.value })
  // Project: phone tab only (right-hand column on a computer).
  if (viewMode.value === 'project') return projectTab.value ? 'project' : hasChat(p) ? 'chat' : 'term'
  return hasChat(p) ? viewMode.value : 'term'
})

// "Project" panel (herdr-projects coordinator): tab on the phone,
// collapsible right-hand column on a computer. Nothing without herdr-projects.
const sideOpen = ref(readSideOpen())
function readSideOpen() {
  try { return localStorage.getItem('projectSide') !== '0' }
  catch { return true }
}
function setSideOpen(v: boolean) {
  sideOpen.value = v
  try { localStorage.setItem('projectSide', v ? '1' : '0') }
  catch { /* stockage indisponible */ }
  haptic()
}
// Column width: handle on its left edge (drag; double-click =
// default width), clamped (260 px, half the area), kept on the device.
// The saved width is also clamped in CSS: the window may shrink.
const sideWidth = ref(readSideWidth())
const sideDrag = ref(false)
const sideStyle = computed(() => (sideWidth.value ? { width: `${sideWidth.value}px` } : undefined))
function onSideGrab(e: PointerEvent) {
  if (e.button !== 0) return
  const handle = e.currentTarget as HTMLElement
  const panel = handle.nextElementSibling as HTMLElement | null
  const area = handle.parentElement?.getBoundingClientRect().width || 0
  if (!panel || !area) return
  e.preventDefault()
  const x0 = e.clientX
  const w0 = panel.getBoundingClientRect().width
  handle.setPointerCapture(e.pointerId)
  sideDrag.value = true
  const move = (ev: PointerEvent) => { sideWidth.value = clampSideWidth(w0 + x0 - ev.clientX, area) }
  const up = () => {
    handle.removeEventListener('pointermove', move)
    handle.removeEventListener('pointerup', up)
    handle.removeEventListener('pointercancel', up)
    sideDrag.value = false
    saveSideWidth(sideWidth.value)
  }
  handle.addEventListener('pointermove', move)
  handle.addEventListener('pointerup', up)
  handle.addEventListener('pointercancel', up)
}
function resetSideWidth() {
  sideWidth.value = null
  saveSideWidth(null)
}

const projectShown = () => !props.cell && (desk.value ? sideOpen.value : viewMode.value === 'project')
const project = useProjectBoard(() => props.paneId, projectShown)
const projectOk = computed(() => !props.cell && project.coordinator.value && project.available.value === true)
const projectTab = computed(() => projectOk.value && !desk.value)
const projectSide = computed(() => projectOk.value && desk.value)

const banner = shallowRef<Banner | null>(null)
const ctl = createTerminal(props.paneId, {
  setBanner: (b) => { banner.value = b },
  hasBanner: () => Boolean(banner.value),
})
const chatRef = ref<{ scrollToEnd: (force: boolean) => void, reload: () => void, focusSearch: () => void } | null>(null)
const composer = ref<{ focus: () => void, focusEnd: () => void, blur: () => void, addImages: (files: File[]) => Promise<void>, stop: () => boolean } | null>(null)
const mirror = ref<{ focus: () => void } | null>(null)
const searchOpen = ref(typeof route.query.q === 'string' && typeof route.query.hit === 'string')

// Pane closed while being viewed. A pane just created may be missing
// from the first state received: we only conclude after seeing it, or after 4 s.
const seen = ref(Boolean(pane.value))
const graceOver = ref(false)
const graceTimer = setTimeout(() => { graceOver.value = true }, 4000)
onUnmounted(() => clearTimeout(graceTimer))
const closedBanner: Banner = { text: t('This pane has been closed.'), btn: t('Back'), fn: () => navigateTo('/') }
const closed = computed(() => !pane.value && herdrState.value.ok && (seen.value || graceOver.value) && !isClosing(props.paneId))
watch(pane, (p) => {
  if (!p) return
  seen.value = true
  if (banner.value === closedBanner) {
    banner.value = null
    if (mode.value === 'term' && !ctl.isConnected()) nextTick(() => ctl.connect(false))
  }
})
watch(closed, (c) => {
  if (c) banner.value = closedBanner
}, { immediate: true })

watch(mode, (m, old) => {
  if (m === 'chat' && old === 'term') {
    banner.value = closed.value ? banner.value : null
  }
})

function setMode(m: PaneViewMode) {
  if (props.cell) emit('activate')
  viewMode.value = m
  if (desk.value && m === 'term') nextTick(() => (props.cell ? mirror.value : ctl)?.focus())
  haptic()
}
// Header icons (phone): one tap shows the terminal (or the Project
// panel), a second one goes back to the conversation.
function toggleMode(m: 'term' | 'project') {
  setMode(toggleViewMode(mode.value, m))
}
function toggleSearch() {
  if (searchOpen.value) searchOpen.value = false
  else {
    searchOpen.value = true
    if (mode.value !== 'chat') viewMode.value = 'chat'
  }
}
// Keyboard (computer, composables/useShortcuts.ts). Mod+F: in the conversation only
// (the browser keeps its search in the terminal). Ctrl+`: the Conversation / Terminal
// selector. Escape: the Stop button, not while searching.
usePaneShortcuts(() => props.paneId, () => live.value, {
  searchChat() {
    if (!pane.value || !hasChat(pane.value) || mode.value !== 'chat') return false
    if (searchOpen.value) chatRef.value?.focusSearch()
    else searchOpen.value = true
    return true
  },
  toggleTerm() {
    if (!pane.value || !hasChat(pane.value) || !mode.value) return false
    const back = mode.value !== 'chat'
    setMode(back ? 'chat' : 'term')
    if (back) nextTick(() => composer.value?.focus())
    return true
  },
  stop: () => mode.value === 'chat' && Boolean(composer.value?.stop()),
})

// "Problem" or "Question" on a task to test (Project panel): the message start goes
// into the input field, cursor at the end; on the phone, back to the
// conversation. Focus given within the gesture: the iPhone opens the keyboard.
const draft = useDraft(props.paneId)
function onPrefill(prefix: string) {
  draft.text = prefillDraft(draft.text, prefix)
  if (!desk.value && viewMode.value === 'project') viewMode.value = hasChat(pane.value) ? 'chat' : 'term'
  composer.value?.focusEnd()
}

// Messages just sent, shown without waiting for the next state.
const localQueued = ref<QueuedMessage[]>([])
function onSent(q: QueuedMessage | null) {
  if (q) localQueued.value = [...localQueued.value, q]
  chatRef.value?.scrollToEnd(true)
  chatRef.value?.reload()
}
// As soon as the server knows them (or after 10 s), the server state wins.
watch(pane, (p) => {
  if (!localQueued.value.length) return
  const known = new Set((p?.queued || []).map(q => q.id))
  localQueued.value = localQueued.value.filter(q => !known.has(q.id) && Date.now() - (q.at || 0) < 10000)
})

const prompt = computed(() => (pane.value && pane.value.status === 'blocked' && pane.value.prompt && pane.value.prompt.options ? pane.value.prompt : null))
const screen = computed(() => knownScreen(pane.value))
// Menu interactif de Claude Code ouvert (/resume…), agent au repos.
const menu = computed(() => (pane.value && pane.value.menu && pane.value.status !== 'working' && !prompt.value && !screen.value ? pane.value.menu : null))
watch(() => JSON.stringify([prompt.value, screen.value, menu.value]), () => nextTick(() => chatRef.value?.scrollToEnd(false)))

const where = computed(() => {
  const p = pane.value
  return p ? shortPath(p.cwd) : ''
})
// Several machines: the agent's, in its metadata.
const machine = computed(() => (multiMachine.value && pane.value ? machineInfo(pane.value.machine) : undefined))
const machineDown = computed(() => Boolean(machine.value && machine.value.status !== 'online'))
const changesOpen = ref(false)
const attachInput = ref<HTMLInputElement | null>(null)
// Interactive menu open (conversation view): what would be typed would go into its
// search; the menu card has its own field.
// Terminal shown (terminal view or mirror): the prompt, waiting screen or
// menu are already there, and the key bar answers them; no duplicate "Your turn" card.
const termShown = computed(() => mode.value === 'term' || mode.value === 'mirror')
const composerShown = computed(() => showComposer({ desk: desk.value, live: live.value, mode: mode.value, cell: Boolean(props.cell) }) && !(menu.value && mode.value !== 'term'))
const canAttachTerminal = computed(() => terminalAttachment({
  desk: desk.value, live: live.value, mode: mode.value,
  available: Boolean(pane.value && eventsOpen.value && !offlineView.value && !machineDown.value && !paneStale(pane.value)),
}))

function attachFile(e: Event) {
  const input = e.target as HTMLInputElement
  const files = [...(input.files || [])]
  input.value = ''
  sendFiles(files)
}
async function sendFiles(files: File[]) {
  if (!canAttachTerminal.value || !pane.value) return
  for (const file of files) {
    try {
      const ext = file.name.includes('.') ? file.name.split('.').pop() || '' : ''
      const r = await fetch(`/api/file?pane=${encodeURIComponent(props.paneId)}&ext=${encodeURIComponent(ext)}`, {
        method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: file,
      })
      const data = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(t(data.error || `HTTP ${r.status}`))
      onSent(await sendMessage(pane.value, props.paneId, data.path))
      haptic()
    } catch (err) { toast(`${t('File upload failed')} : ${(err as Error).message}`, true) }
  }
}

// Files dragged from the Finder / file explorer: conversation → photos of the
// field (same path as the "+"); terminal → same send as "Attach a
// file…". Elsewhere (Project panel, offline), nothing: app.vue only stops
// the browser from opening the file.
const dropTarget = computed<'chat' | 'term' | null>(() => {
  if (canAttachTerminal.value) return 'term'
  if (composerShown.value && mode.value !== 'project' && !offlineView.value) return 'chat'
  return null
})
const dropDepth = ref(0)
function onDrag(e: DragEvent) {
  if (!carriesFiles(e.dataTransfer) || !dropTarget.value) return
  e.preventDefault()
  if (e.type === 'dragover' && e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
  dropDepth.value = dragDepth(dropDepth.value, e.type)
}
function onDrop(e: DragEvent) {
  dropDepth.value = 0
  if (!carriesFiles(e.dataTransfer) || !dropTarget.value) return
  e.preventDefault()
  const files = [...(e.dataTransfer?.files || [])]
  if (!files.length) return
  if (dropTarget.value === 'term') return sendFiles(files)
  const { images, refused } = splitDropped(files)
  if (refused.length) toast(tl(`Only images can be attached to a message: ${refused.map(f => f.name).join(', ')}`, `Seules les images se joignent au message : ${refused.map(f => f.name).join(', ')}`), true)
  if (images.length) {
    composer.value?.addImages(images)
    composer.value?.focus()
    haptic()
  }
}

// Agent menu: sheet on the phone, dropdown menu on a computer.
const agentMenu = computed<MenuItem[]>(() => {
  const p = pane.value
  const items: MenuItem[] = []
  if (canAttachTerminal.value) items.push({ label: t('Attach a file…'), icon: 'i-lucide-paperclip', run: () => attachInput.value?.click() })
  if (p) items.push({ label: t('View changes'), icon: 'i-lucide-file-diff', run: () => { changesOpen.value = true } })
  if (p) items.push({ label: t('Rename pane'), icon: 'i-lucide-pencil', run: () => { renameTarget.value = p.id } })
  // Split, move to another tab (never zoom or resize).
  if (p) items.push(...paneSpaceItems(p))
  if (p) items.push(copyPaneIdItem(p))
  // Herdr plugin actions of its machine that apply to a workspace / pane.
  if (p && agentPluginActions(p.machine).length) {
    items.push({ label: t('Plugin actions'), icon: 'i-lucide-puzzle', run: () => openPluginMenu({ pane: p }) })
  }
  items.push({
    label: t('Take control of this terminal'), icon: 'i-lucide-arrow-left-right',
    run: () => { banner.value = null; viewMode.value = 'term'; nextTick(() => ctl.connect(true)) },
  })
  // Relaunch Claude / Codex in this pane, on the same conversation.
  if (p && canRestart(p) && !p.restart) items.push({ label: t('Restart agent'), icon: 'i-lucide-rotate-cw', run: () => restartAgent(p) })
  items.push({
    label: t('Reconnect'), icon: 'i-lucide-refresh-cw',
    run: () => { banner.value = null; viewMode.value = 'term'; nextTick(() => { ctl.reset(); ctl.connect(false) }) },
  })
  // Tab and space: long press (right click) on the tab, the space card
  // or its title; new tab: the "+" of the header or of the tabs.
  if (!props.cell) items.push(...settingsMenuItems())
  if (p) {
    items.push({ kind: 'separator' })
    items.push({
      label: p.agent ? tl(`Close this pane (stops ${kindLabel(p.agent)})`, `Fermer ce pane (arrête ${kindLabel(p.agent)})`) : t('Close this terminal'),
      icon: 'i-lucide-trash-2', danger: true, kbds: live.value ? shortcutKbds('close-pane') : undefined, run: () => closePane(p),
    })
    // Pane in a worktree: remove the checkout (and close its workspace).
    const ws = herdrState.value.workspaces.find(w => w.id === p.workspace)
    if (ws && ws.worktree) {
      items.push({ label: t('Delete this worktree'), icon: 'i-lucide-git-branch', danger: true, run: () => removeWorktreeOf(p.workspace) })
    }
  }
  return items
})
async function removeWorktreeOf(workspace: string) {
  await loadWorktrees()
  const w = (worktrees.value || []).find(x => x.workspace === workspace)
  if (!w) return toast(t('Worktree not found'), true)
  if (await removeWorktreeFlow(w)) navigateTo('/')
}
const dropdownItems = computed(() => toDropdown(agentMenu.value))
function openAgentMenu() { openMenu(agentMenu.value) }
watch(() => pane.value && (pane.value.machine || ''), (m) => { if (m !== undefined) loadPluginActions(m) }, { immediate: true })

// Conversation / Terminal selector (computer): in the pane header
// or in the side-by-side cell's. The Project panel is a column there.
const tabs = computed(() => [
  { label: t('Conversation'), value: 'chat' },
  { label: t('Terminal'), value: 'term' },
])
const tab = computed({
  get: () => (mode.value === 'mirror' || mode.value === 'term' ? 'term' : 'chat'),
  set: (v: string) => setMode(v === 'term' ? 'term' : 'chat'),
})
const controls = computed(() => viewControls({ desk: desk.value, cell: Boolean(props.cell), chat: hasChat(pane.value), live: live.value, project: projectTab.value }))
const headerAdd = computed(() => !props.cell && pane.value && spaceTabControls(spaceTabs(pane.value.workspace).length).headerAdd)

watch(fontSize, n => ctl.setFontSize(n))
watch(pageVisible, (v) => {
  ctl.setVisible(v)
  if (v && mode.value === 'term' && !ctl.isConnected() && !banner.value) ctl.connect(false)
})

// ------------------------------------------------------------ onglet
const tabEnt = computed(() => (pane.value ? tabOf(pane.value.tab) : null))
const inTab = computed(() => Boolean(tabEnt.value && tabEnt.value.panes.length > 1))
function openPlan() {
  if (!tabEnt.value) return
  if (desk.value) navigateTo({ path: tabPath(tabEnt.value.tab.id), query: { pane: props.paneId } })
  else backToTab(tabEnt.value.tab.id)
}
// Back: to the tab's plan if we came from it, otherwise to the list.
function goBack() {
  const back = (history.state as { back?: string } | null)?.back
  if (tabEnt.value && back === tabPath(tabEnt.value.tab.id)) router.back()
  else navigateTo('/')
}

// Swipe (phone, conversation): the conversation follows the finger, damped,
// braked at the edge; far or fast enough, the neighbour replaces it (same
// history entry: back returns to the plan).
const enter = swipeDir.value
swipeDir.value = 0
const drag = ref(0)
const dragging = ref(false)
let sx = 0
let sy = 0
let st = 0
let axis: 'x' | 'y' | null | 'off' = 'off'
const neighbor = (step: 1 | -1) => (tabEnt.value ? neighborPane(tabEnt.value.layout, props.paneId, step) : null)
// Block that scrolls sideways itself (code, table): the gesture belongs to it.
function scrollsSideways(el: EventTarget | null, root: HTMLElement) {
  for (let n = el as HTMLElement | null; n && n !== root; n = n.parentElement) {
    if (n.scrollWidth > n.clientWidth + 1 && /(auto|scroll)/.test(getComputedStyle(n).overflowX)) return true
  }
  return false
}
// Gesture taken on the conversation, the agent's question or the terminal (which
// only scrolls vertically); not on the key bar or the input field.
function onSwipeStart(e: TouchEvent) {
  axis = 'off'
  if (desk.value || !inTab.value || e.touches.length !== 1) return
  const zone = (e.target as HTMLElement | null)?.closest?.('.swipe-area, .choices, #termWrap') as HTMLElement | null
  if (!zone || scrollsSideways(e.target, zone)) return
  sx = e.touches[0]!.clientX
  sy = e.touches[0]!.clientY
  st = Date.now()
  axis = null
}
function onSwipeMove(e: TouchEvent) {
  if (axis === 'off' || axis === 'y') return
  const dx = e.touches[0]!.clientX - sx
  const dy = e.touches[0]!.clientY - sy
  if (axis === null) axis = swipeAxis(dx, dy)
  if (axis !== 'x') return
  e.preventDefault()
  dragging.value = true
  drag.value = swipeOffset(dx, Boolean(neighbor(dx < 0 ? 1 : -1)))
}
function onSwipeEnd(e: TouchEvent) {
  if (axis === 'x') {
    const dx = (e.changedTouches[0]?.clientX ?? sx) - sx
    const step = swipeStep(dx, Date.now() - st, window.innerWidth)
    const target = step ? neighbor(step) : null
    if (target) {
      haptic()
      swipeDir.value = step
      router.replace(panePath(target))
    }
  }
  axis = 'off'
  dragging.value = false
  drag.value = 0
}
const swipeStyle = computed(() => (inTab.value && !desk.value
  ? { transform: drag.value ? `translateX(${drag.value}px)` : undefined, transition: dragging.value ? 'none' : 'transform .18s ease' }
  : {}))

// Computer: give the keyboard to the interactive view on opening.
onMounted(() => {
  if (desk.value && live.value) setTimeout(() => (mode.value === 'term' ? ctl : mode.value === 'mirror' ? mirror.value : composer.value)?.focus(), 50)
})
// Cell just activated by a click outside its content: we give it the keyboard.
watch(() => props.active, (a, was) => {
  if (a && !was && props.cell) setTimeout(() => { if (!document.activeElement?.closest('.cell-view.active')) (mode.value === 'mirror' ? mirror.value : composer.value)?.focus() }, 50)
})

// Keyboard open (iPhone): the view fits the visible part.
const viewStyle = computed(() => (kbOpen.value ? { height: `${vvHeight.value}px`, top: `${vvTop.value}px` } : {}))
</script>

<template>
  <section
    :id="cell ? undefined : 'agent'" :class="cell ? ['cell-view', { active, gripped: grip }] : 'view'" :style="cell ? undefined : viewStyle" :data-pane="cell ? paneId : undefined"
    @touchstart="onSwipeStart" @touchmove="onSwipeMove" @touchend="onSwipeEnd" @touchcancel="onSwipeEnd"
    @pointerdown.capture="cell && emit('activate')" @focusin="cell && emit('activate')"
    @dragenter="onDrag" @dragover="onDrag" @dragleave="onDrag" @drop="onDrop"
  >
    <div v-if="dropDepth && dropTarget" class="file-drop" aria-hidden="true">
      <UIcon :name="dropTarget === 'term' ? 'i-lucide-paperclip' : 'i-lucide-image-plus'" class="file-drop-icon" />
      <span class="file-drop-label">{{ t('Drop to attach') }}</span>
      <small>{{ dropTarget === 'term' ? t('The file path is sent to the terminal') : t('Images · resized before upload') }}</small>
    </div>
    <SpaceTabs v-if="!cell && pane" :workspace="pane.workspace" :current="pane.tab" />
    <HeaderMenu :items="() => agentMenu" :disabled="!pane">
      <header class="top bar agent-top">
        <span v-if="cell && grip" class="cell-grip" role="button" :aria-label="t('Drag to move the pane')" :title="t('Drag to move the pane')">
          <UIcon name="i-lucide-grip-vertical" />
        </span>
        <UButton
          v-if="!cell" id="btnBack" icon="i-lucide-chevron-left" color="neutral" variant="ghost" size="lg" class="icon-btn back"
          :aria-label="t('Back')" @click="goBack"
        />
        <div class="agent-head">
          <div class="agent-title">{{ headTitle }}</div>
          <div class="agent-meta">
            <StatusPill :pane="pane" kind />
            <span v-if="subtitle" class="agent-subtitle">{{ subtitle }}</span>
            <span v-if="command" class="agent-subtitle agent-command">{{ command }}</span>
            <span v-if="tabName" class="agent-subtitle">{{ tabName }}</span>
            <span v-if="machine" class="agent-machine" :class="machine.status" :title="machine.target ? `ssh ${machine.target}` : undefined">
              <UIcon :name="machine.local ? 'i-lucide-server' : 'i-lucide-laptop'" /><span class="machine-inline-name">{{ machineName(machine.key) }}</span><MachineLocalBadge v-if="machine.local" />
            </span>
            <span v-if="where" class="where">{{ where }}</span>
          </div>
        </div>
        <UTabs
          v-if="controls.selector === 'cell'" v-model="tab" :items="tabs" :content="false" color="neutral" variant="pill" size="xs"
          class="view-tabs" :ui="{ list: 'hw-tabs', trigger: 'hw-tab', indicator: 'hw-tab-ind' }"
        />
        <div class="agent-actions">
          <UTabs
            v-if="controls.selector === 'header'" v-model="tab" :items="tabs" :content="false" color="neutral" variant="pill" size="xs"
            class="view-tabs" :ui="{ list: 'hw-tabs', trigger: 'hw-tab', indicator: 'hw-tab-ind' }"
          />
          <UButton
            v-if="headerAdd && pane" icon="i-lucide-plus" color="neutral" variant="ghost" size="lg" class="icon-btn"
            :aria-label="t('New tab')" :title="t('New tab')" :disabled="offlineView" @click="newTab(pane.workspace)"
          />
          <UTooltip v-if="cell" :text="t('Open alone')">
            <UButton icon="i-lucide-maximize-2" color="neutral" variant="ghost" size="md" class="icon-btn" :aria-label="t('Open alone')" :to="panePath(paneId)" />
          </UTooltip>
          <UTooltip v-else-if="inTab && tabEnt" :text="t('Side by side')" :disabled="!desk">
            <button type="button" class="map-btn" :aria-label="desk ? t('Side by side') : t('Tab overview')" @click="openPlan">
              <TabMap :layout="tabEnt.layout" :panes="tabEnt.panes" :current="paneId" />
            </button>
          </UTooltip>
          <UTooltip v-if="projectSide && !sideOpen" :text="t('Show the Project panel')">
            <UButton icon="i-lucide-panel-right-open" color="neutral" variant="ghost" size="lg" class="icon-btn" :aria-label="t('Show the Project panel')" @click="setSideOpen(true)" />
          </UTooltip>
          <UButton
            v-if="controls.project" icon="i-lucide-folder-kanban" color="neutral" variant="ghost" size="lg" class="icon-btn mode-btn"
            :class="{ on: mode === 'project' }" :aria-label="t('Project')" :aria-pressed="mode === 'project'" @click="toggleMode('project')"
          />
          <UButton
            v-if="controls.term" icon="i-lucide-square-terminal" color="neutral" variant="ghost" size="lg" class="icon-btn mode-btn"
            :class="{ on: mode === 'term' }" :aria-label="t('Terminal')" :aria-pressed="mode === 'term'" @click="toggleMode('term')"
          />
          <UTooltip v-if="hasChat(pane) && (live || cell)" :text="t('Search')" :kbds="mode === 'chat' ? shortcutKbds('search-chat') : undefined" :disabled="!desk">
            <UButton icon="i-lucide-search" color="neutral" variant="ghost" size="lg" class="icon-btn" :class="{ on: searchOpen }" :aria-label="t('Search')" @click="toggleSearch" />
          </UTooltip>
          <UDropdownMenu v-if="desk" :items="dropdownItems" :content="{ align: 'end', sideOffset: 6 }" :ui="{ content: 'hw-dropdown' }">
            <UButton icon="i-lucide-ellipsis" color="neutral" variant="ghost" size="lg" class="icon-btn" :aria-label="t('Options')" />
          </UDropdownMenu>
          <UButton v-else icon="i-lucide-ellipsis" color="neutral" variant="ghost" size="lg" class="icon-btn" :aria-label="t('Options')" @click="openAgentMenu" />
        </div>
      </header>
    </HeaderMenu>

    <div class="agent-body">
    <div class="agent-main">
    <div v-if="machineDown && machine" class="term-banner machine-banner">
      <UIcon name="i-lucide-unplug" class="term-banner-icon" />
      <span>{{ machine.status === 'connecting' ? tl(`${machineName(machine.key)} unreachable — reconnecting…`, `${machineName(machine.key)} injoignable — reconnexion…`) : tl(`${machineName(machine.key)} offline`, `${machineName(machine.key)} hors ligne`) }}<small v-if="machine.error">{{ t(machine.error) }}</small></span>
    </div>
    <div v-if="banner" class="term-banner">
      <UIcon name="i-lucide-triangle-alert" class="term-banner-icon" />
      <span>{{ banner.text }}</span>
      <UButton size="xs" color="warning" variant="outline" @click="banner.fn()">{{ banner.btn }}</UButton>
    </div>

    <div
      v-if="pane && mode === 'chat'" class="swipe-area" :class="enter ? (enter > 0 ? 'enter-next' : 'enter-prev') : undefined" :style="swipeStyle"
    >
      <ChatView
        ref="chatRef" v-model:search="searchOpen" :pane="pane" :local-queued="localQueued"
        @goto-term="setMode('term')" @restored="composer?.focus()" @reply="composer?.focus()"
      />
    </div>
    <div v-else-if="(mode === 'term' || mode === 'mirror') && (!eventsOpen || offlineView || machineDown)" class="chat-empty offline-terminal"><UIcon name="i-lucide-wifi-off" class="chat-empty-icon" /><p>{{ t('Terminal unavailable offline') }}</p></div>
    <TerminalView
      v-else-if="mode === 'term'" :ctl="ctl" :class="enter ? (enter > 0 ? 'enter-next' : 'enter-prev') : undefined" :style="swipeStyle"
    />
    <MirrorView v-else-if="mode === 'mirror'" ref="mirror" :pane-id="paneId" :interactive="active" />
    <ProjectPanel
      v-else-if="mode === 'project'" :pane-id="paneId" :board="project.board.value" :loading="project.loading.value" :error="project.error.value"
      @reload="project.reload()" @sent="onSent" @prefill="onPrefill"
    />
    <div v-else class="chat" />
    <p v-if="pane?.agent && !hasChat(pane) && mode === 'term'" class="terminal-transcript-note">{{ tl('Conversation unavailable for this agent · follow it in the terminal', 'Conversation non disponible pour cet agent · suivi dans le terminal') }}</p>

    <ChoicesPanel v-if="(prompt || screen) && !termShown && eventsOpen && !offlineView && !machineDown" :pane-id="paneId" :prompt="prompt" :screen="screen" :keys="live" />
    <MenuPanel v-else-if="menu && !termShown && eventsOpen && !offlineView && !machineDown" :pane-id="paneId" :menu="menu" :keys="live" @terminal="setMode('term')" />
    <Keybar v-if="mode === 'term' && eventsOpen && !offlineView && !machineDown" :ctl="ctl" />
    <Composer v-if="composerShown" ref="composer" :pane="pane" :pane-id="paneId" :send-keys="ctl.sendKeys" :esc-stops="!searchOpen" :take-back="mode === 'chat'" @sent="onSent" @show-terminal="setMode('term')" />
    </div>
    <div
      v-if="projectSide && sideOpen" class="side-handle" :class="{ dragging: sideDrag }" role="separator" aria-orientation="vertical"
      :aria-label="t('Project panel width')" :title="t('Drag to resize · double-click: default width')"
      @pointerdown="onSideGrab" @dblclick="resetSideWidth"
    />
    <ProjectPanel
      v-if="projectSide && sideOpen" side :style="sideStyle" :class="{ resizing: sideDrag }" :pane-id="paneId" :board="project.board.value" :loading="project.loading.value" :error="project.error.value"
      @reload="project.reload()" @collapse="setSideOpen(false)" @sent="onSent" @prefill="onPrefill"
    />
    </div>
    <AppSheet v-model:open="changesOpen" :title="t('Changes')" wide full screen>
      <ChangesView v-if="changesOpen && pane" :pane-id="paneId" />
    </AppSheet>
    <input ref="attachInput" type="file" multiple hidden @change="attachFile">
  </section>
</template>
