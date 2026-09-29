<script lang="ts">
// Vue qui a posé `curPane` en dernier (partagé par toutes les instances).
let curPaneOwner: symbol | null = null
</script>

<script setup lang="ts">
// Vue d'un agent : onglets du space, en-tête, puis le pane (sélecteur
// Conversation / Terminal, invite bloquante, barre de touches, barre de saisie).
// Téléphone : pas de sélecteur, des icônes d'en-tête (terminal `>_`, Projet)
// basculent la présentation du pane. Ordinateur : petit sélecteur dans
// l'en-tête (ou dans celui de la case, côte à côte).
// Pane d'un onglet de plusieurs panes : mini-carte de l'onglet dans l'en-tête
// (retour au plan, ou vue côte à côte sur ordinateur) et, sur téléphone,
// balayage gauche / droite vers les voisins (ordre de lecture de Herdr).
// `cell` : case de la vue côte à côte (ordinateur). Toutes les cases sont
// vivantes : la conversation, ou le miroir du terminal (MirrorView, sans jamais
// redimensionner le vrai pane). Seule la case active (`active`, un clic dans
// une case l'active) a le champ de saisie, et son miroir reçoit les frappes.
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

// Pane regardé (pas de notification pour lui, lu dès qu'il est fini) : la case
// active. La vue qui l'a posé est seule à l'effacer (la vue suivante du même pane
// peut se monter avant que la précédente ne se démonte).
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
const subtitle = computed(() => pane.value ? conversationSubtitle(pane.value, workspace.value) : '')
const tabName = computed(() => pane.value && herdrState.value.tabs?.filter(x => x.workspace === pane.value?.workspace).length! > 1 ? pane.value.tabLabel : '')
// Onglet de ce pane (chaque conversation garde le sien).
const viewMode = computed<PaneViewMode>({
  get: () => paneViewMode(props.paneId),
  set: m => setPaneViewMode(props.paneId, m),
})
// État pas encore reçu (ouverture depuis une notification) : on attend de
// savoir si c'est un agent, pour ne pas ouvrir le terminal pour rien.
// Case : le mode mémorisé du pane (conversation ou miroir du terminal), que la
// case ait le focus ou non ; le focus ne change que la bordure et la saisie.
const mode = computed<PaneViewMode | 'mirror' | null>(() => {
  const p = pane.value
  if (!p) return null
  if (props.cell) return cellMode({ chat: hasChat(p), viewMode: viewMode.value })
  // Projet : onglet du téléphone seulement (colonne à droite sur ordinateur).
  if (viewMode.value === 'project') return projectTab.value ? 'project' : hasChat(p) ? 'chat' : 'term'
  return hasChat(p) ? viewMode.value : 'term'
})

// Panneau « Projet » (coordinateur herdr-projects) : onglet sur téléphone,
// colonne repliable à droite sur ordinateur. Rien sans herdr-projects.
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
// Largeur de la colonne : poignée sur son bord gauche (glisser ; double-clic =
// largeur par défaut), bornée (260 px, moitié de la zone), gardée sur l'appareil.
// La largeur enregistrée est aussi bornée en CSS : la fenêtre peut rétrécir.
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
const chatRef = ref<{ scrollToEnd: (force: boolean) => void, reload: () => void } | null>(null)
const composer = ref<{ focus: () => void, focusEnd: () => void, blur: () => void, addImages: (files: File[]) => Promise<void> } | null>(null)
const mirror = ref<{ focus: () => void } | null>(null)
const searchOpen = ref(typeof route.query.q === 'string' && typeof route.query.hit === 'string')

// Pane fermé pendant qu'on le regarde. Un pane tout juste créé peut manquer
// au premier état reçu : on ne conclut qu'après l'avoir vu, ou après 4 s.
const seen = ref(Boolean(pane.value))
const graceOver = ref(false)
const graceTimer = setTimeout(() => { graceOver.value = true }, 4000)
onUnmounted(() => clearTimeout(graceTimer))
const closedBanner: Banner = { text: t('Ce pane a été fermé.'), btn: t('Retour'), fn: () => navigateTo('/') }
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
// Icônes d'en-tête (téléphone) : un toucher montre le terminal (ou le panneau
// Projet), un second revient à la conversation.
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

// « Problème » ou « Question » d'une tâche à tester (panneau Projet) : le début du message va
// dans le champ de saisie, curseur à la fin ; sur téléphone, retour à la
// conversation. Focus donné dans le geste : l'iPhone ouvre le clavier.
const draft = useDraft(props.paneId)
function onPrefill(prefix: string) {
  draft.text = prefillDraft(draft.text, prefix)
  if (!desk.value && viewMode.value === 'project') viewMode.value = hasChat(pane.value) ? 'chat' : 'term'
  composer.value?.focusEnd()
}

// Messages envoyés à l'instant, affichés sans attendre le prochain état.
const localQueued = ref<QueuedMessage[]>([])
function onSent(q: QueuedMessage | null) {
  if (q) localQueued.value = [...localQueued.value, q]
  chatRef.value?.scrollToEnd(true)
  chatRef.value?.reload()
}
// Dès que le serveur les connaît (ou après 10 s), l'état du serveur fait foi.
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
// Plusieurs machines : celle de l'agent, dans ses métadonnées.
const machine = computed(() => (multiMachine.value && pane.value ? machineInfo(pane.value.machine) : undefined))
const machineDown = computed(() => Boolean(machine.value && machine.value.status !== 'online'))
const changesOpen = ref(false)
const attachInput = ref<HTMLInputElement | null>(null)
// Menu interactif ouvert (vue conversation) : ce qui serait tapé irait dans sa
// recherche ; la carte du menu a son propre champ.
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
    } catch (err) { toast(`${t('Fichier non envoyé')} : ${(err as Error).message}`, true) }
  }
}

// Fichiers glissés depuis le Finder / l'explorateur : conversation → photos du
// champ (même chemin que le « + ») ; terminal → même envoi que « Joindre un
// fichier… ». Ailleurs (panneau Projet, hors ligne), rien : app.vue empêche
// seulement le navigateur d'ouvrir le fichier.
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
  if (refused.length) toast(tl(`Seules les images se joignent au message : ${refused.map(f => f.name).join(', ')}`, `Only images can be attached to a message: ${refused.map(f => f.name).join(', ')}`), true)
  if (images.length) {
    composer.value?.addImages(images)
    composer.value?.focus()
    haptic()
  }
}

// Menu de l'agent : feuille sur téléphone, menu déroulant sur ordinateur.
const agentMenu = computed<MenuItem[]>(() => {
  const p = pane.value
  const items: MenuItem[] = []
  if (canAttachTerminal.value) items.push({ label: t('Joindre un fichier…'), icon: 'i-lucide-paperclip', run: () => attachInput.value?.click() })
  if (p) items.push({ label: t('Voir les changements'), icon: 'i-lucide-file-diff', run: () => { changesOpen.value = true } })
  if (p && workspace.value) items.push({ label: t('Renommer l’espace'), icon: 'i-lucide-pencil', run: () => renameWorkspace(workspace.value!.id) })
  // Diviser, déplacer vers un autre onglet (jamais de zoom ni de redimensionnement).
  if (p) items.push(...paneSpaceItems(p))
  if (p) items.push(copyPaneIdItem(p))
  // Actions des plugins Herdr de sa machine qui portent sur un workspace / pane.
  if (p && agentPluginActions(p.machine).length) {
    items.push({ label: t('Actions des plugins'), icon: 'i-lucide-puzzle', run: () => openPluginMenu({ pane: p }) })
  }
  items.push({
    label: t('Prendre la main sur ce terminal'), icon: 'i-lucide-arrow-left-right',
    run: () => { banner.value = null; viewMode.value = 'term'; nextTick(() => ctl.connect(true)) },
  })
  // Relancer Claude / Codex dans ce pane, sur la même conversation.
  if (p && canRestart(p) && !p.restart) items.push({ label: t('Redémarrer l’agent'), icon: 'i-lucide-rotate-cw', run: () => restartAgent(p) })
  items.push({
    label: t('Reconnecter'), icon: 'i-lucide-refresh-cw',
    run: () => { banner.value = null; viewMode.value = 'term'; nextTick(() => { ctl.reset(); ctl.connect(false) }) },
  })
  // Onglet et espace : appui long (clic droit) sur l'onglet, la carte du space
  // ou son titre ; nouvel onglet : le « + » de l'en-tête ou des onglets.
  if (!props.cell) items.push(...settingsMenuItems())
  if (p) {
    items.push({ kind: 'separator' })
    items.push({
      label: p.agent ? tl(`Fermer ce pane (arrête ${kindLabel(p.agent)})`, `Close this pane (stops ${kindLabel(p.agent)})`) : t('Fermer ce terminal'),
      icon: 'i-lucide-trash-2', danger: true, run: () => closePane(p),
    })
    // Pane dans un worktree : supprimer le checkout (et fermer son workspace).
    const ws = herdrState.value.workspaces.find(w => w.id === p.workspace)
    if (ws && ws.worktree) {
      items.push({ label: t('Supprimer ce worktree'), icon: 'i-lucide-git-branch', danger: true, run: () => removeWorktreeOf(p.workspace) })
    }
  }
  return items
})
async function removeWorktreeOf(workspace: string) {
  await loadWorktrees()
  const w = (worktrees.value || []).find(x => x.workspace === workspace)
  if (!w) return toast(t('Worktree introuvable'), true)
  if (await removeWorktreeFlow(w)) navigateTo('/')
}
const dropdownItems = computed(() => toDropdown(agentMenu.value))
function openAgentMenu() { openMenu(agentMenu.value) }
watch(() => pane.value && (pane.value.machine || ''), (m) => { if (m !== undefined) loadPluginActions(m) }, { immediate: true })

// Sélecteur Conversation / Terminal (ordinateur) : dans l'en-tête du pane
// ou de la case côte à côte. Le panneau Projet y est une colonne.
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
// Retour : au plan de l'onglet si on en vient, sinon à la liste.
function goBack() {
  const back = (history.state as { back?: string } | null)?.back
  if (tabEnt.value && back === tabPath(tabEnt.value.tab.id)) router.back()
  else navigateTo('/')
}

// Balayage (téléphone, conversation) : la conversation suit le doigt, amortie,
// freinée au bord ; assez loin ou assez vite, le voisin la remplace (même
// entrée d'historique : le retour ramène au plan).
const enter = swipeDir.value
swipeDir.value = 0
const drag = ref(0)
const dragging = ref(false)
let sx = 0
let sy = 0
let st = 0
let axis: 'x' | 'y' | null | 'off' = 'off'
const neighbor = (step: 1 | -1) => (tabEnt.value ? neighborPane(tabEnt.value.layout, props.paneId, step) : null)
// Bloc qui défile lui-même de côté (code, tableau) : le geste lui revient.
function scrollsSideways(el: EventTarget | null, root: HTMLElement) {
  for (let n = el as HTMLElement | null; n && n !== root; n = n.parentElement) {
    if (n.scrollWidth > n.clientWidth + 1 && /(auto|scroll)/.test(getComputedStyle(n).overflowX)) return true
  }
  return false
}
// Geste pris sur la conversation, la question de l'agent ou le terminal (qui
// ne défile que verticalement) ; pas sur la barre de touches ni le champ de saisie.
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

// Ordinateur : donner le clavier à la vue interactive à l'ouverture.
onMounted(() => {
  if (desk.value && live.value) setTimeout(() => (mode.value === 'term' ? ctl : mode.value === 'mirror' ? mirror.value : composer.value)?.focus(), 50)
})
// Case tout juste activée d'un clic ailleurs que dans son contenu : on lui donne le clavier.
watch(() => props.active, (a, was) => {
  if (a && !was && props.cell) setTimeout(() => { if (!document.activeElement?.closest('.cell-view.active')) (mode.value === 'mirror' ? mirror.value : composer.value)?.focus() }, 50)
})

// Clavier ouvert (iPhone) : la vue se cale sur la partie visible.
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
      <span class="file-drop-label">{{ t('Déposer pour joindre') }}</span>
      <small>{{ dropTarget === 'term' ? t('Le chemin du fichier part dans le terminal') : t('Images · réduites avant l’envoi') }}</small>
    </div>
    <SpaceTabs v-if="!cell && pane" :workspace="pane.workspace" :current="pane.tab" />
    <header class="top bar agent-top">
      <span v-if="cell && grip" class="cell-grip" role="button" :aria-label="t('Glisser pour déplacer le pane')" :title="t('Glisser pour déplacer le pane')">
        <UIcon name="i-lucide-grip-vertical" />
      </span>
      <UButton
        v-if="!cell" id="btnBack" icon="i-lucide-chevron-left" color="neutral" variant="ghost" size="lg" class="icon-btn back"
        :aria-label="t('Retour')" @click="goBack"
      />
      <div class="agent-head">
        <div class="agent-title">{{ pane ? spaceTitle(pane, workspace) : '—' }}</div>
        <div class="agent-meta">
          <StatusPill :pane="pane" kind />
          <span v-if="subtitle" class="agent-subtitle">{{ subtitle }}</span>
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
          :aria-label="t('Nouvel onglet')" :title="t('Nouvel onglet')" :disabled="offlineView" @click="newTab(pane.workspace)"
        />
        <UTooltip v-if="cell" :text="t('Ouvrir seul')">
          <UButton icon="i-lucide-maximize-2" color="neutral" variant="ghost" size="md" class="icon-btn" :aria-label="t('Ouvrir seul')" :to="panePath(paneId)" />
        </UTooltip>
        <UTooltip v-else-if="inTab && tabEnt" :text="t('Côte à côte')" :disabled="!desk">
          <button type="button" class="map-btn" :aria-label="desk ? t('Côte à côte') : t('Plan de l’onglet')" @click="openPlan">
            <TabMap :layout="tabEnt.layout" :panes="tabEnt.panes" :current="paneId" />
          </button>
        </UTooltip>
        <UTooltip v-if="projectSide && !sideOpen" :text="t('Afficher le panneau Projet')">
          <UButton icon="i-lucide-panel-right-open" color="neutral" variant="ghost" size="lg" class="icon-btn" :aria-label="t('Afficher le panneau Projet')" @click="setSideOpen(true)" />
        </UTooltip>
        <UButton
          v-if="controls.project" icon="i-lucide-folder-kanban" color="neutral" variant="ghost" size="lg" class="icon-btn mode-btn"
          :class="{ on: mode === 'project' }" :aria-label="t('Projet')" :aria-pressed="mode === 'project'" @click="toggleMode('project')"
        />
        <UButton
          v-if="controls.term" icon="i-lucide-square-terminal" color="neutral" variant="ghost" size="lg" class="icon-btn mode-btn"
          :class="{ on: mode === 'term' }" :aria-label="t('Terminal')" :aria-pressed="mode === 'term'" @click="toggleMode('term')"
        />
        <UTooltip v-if="hasChat(pane) && (live || cell)" :text="t('Rechercher')" :disabled="!desk">
          <UButton icon="i-lucide-search" color="neutral" variant="ghost" size="lg" class="icon-btn" :class="{ on: searchOpen }" :aria-label="t('Rechercher')" @click="toggleSearch" />
        </UTooltip>
        <UDropdownMenu v-if="desk" :items="dropdownItems" :content="{ align: 'end', sideOffset: 6 }" :ui="{ content: 'hw-dropdown' }">
          <UButton icon="i-lucide-ellipsis" color="neutral" variant="ghost" size="lg" class="icon-btn" :aria-label="t('Options')" />
        </UDropdownMenu>
        <UButton v-else icon="i-lucide-ellipsis" color="neutral" variant="ghost" size="lg" class="icon-btn" :aria-label="t('Options')" @click="openAgentMenu" />
      </div>
    </header>

    <div class="agent-body">
    <div class="agent-main">
    <div v-if="machineDown && machine" class="term-banner machine-banner">
      <UIcon name="i-lucide-unplug" class="term-banner-icon" />
      <span>{{ machine.status === 'connecting' ? tl(`${machineName(machine.key)} injoignable — reconnexion…`, `${machineName(machine.key)} unreachable — reconnecting…`) : tl(`${machineName(machine.key)} hors ligne`, `${machineName(machine.key)} offline`) }}<small v-if="machine.error">{{ machine.error }}</small></span>
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
    <div v-else-if="(mode === 'term' || mode === 'mirror') && (!eventsOpen || offlineView || machineDown)" class="chat-empty offline-terminal"><UIcon name="i-lucide-wifi-off" class="chat-empty-icon" /><p>{{ t('Terminal indisponible hors ligne') }}</p></div>
    <TerminalView
      v-else-if="mode === 'term'" :ctl="ctl" :class="enter ? (enter > 0 ? 'enter-next' : 'enter-prev') : undefined" :style="swipeStyle"
    />
    <MirrorView v-else-if="mode === 'mirror'" ref="mirror" :pane-id="paneId" :interactive="active" />
    <ProjectPanel
      v-else-if="mode === 'project'" :pane-id="paneId" :board="project.board.value" :loading="project.loading.value" :error="project.error.value"
      @reload="project.reload()" @sent="onSent" @prefill="onPrefill"
    />
    <div v-else class="chat" />
    <p v-if="pane?.agent && !hasChat(pane) && mode === 'term'" class="terminal-transcript-note">{{ tl('Conversation non disponible pour cet agent · suivi dans le terminal', 'Conversation unavailable for this agent · follow it in the terminal') }}</p>

    <ChoicesPanel v-if="(prompt || screen) && eventsOpen && !offlineView && !machineDown" :pane-id="paneId" :prompt="prompt" :screen="screen" />
    <MenuPanel v-else-if="menu && mode !== 'term' && eventsOpen && !offlineView && !machineDown" :pane-id="paneId" :menu="menu" @terminal="setMode('term')" />
    <Keybar v-if="mode === 'term' && eventsOpen && !offlineView && !machineDown" :ctl="ctl" />
    <Composer v-if="composerShown" ref="composer" :pane="pane" :pane-id="paneId" :send-keys="ctl.sendKeys" @sent="onSent" @show-terminal="setMode('term')" />
    </div>
    <div
      v-if="projectSide && sideOpen" class="side-handle" :class="{ dragging: sideDrag }" role="separator" aria-orientation="vertical"
      :aria-label="t('Largeur du panneau Projet')" :title="t('Glisser pour élargir · double-clic : largeur par défaut')"
      @pointerdown="onSideGrab" @dblclick="resetSideWidth"
    />
    <ProjectPanel
      v-if="projectSide && sideOpen" side :style="sideStyle" :class="{ resizing: sideDrag }" :pane-id="paneId" :board="project.board.value" :loading="project.loading.value" :error="project.error.value"
      @reload="project.reload()" @collapse="setSideOpen(false)" @sent="onSent" @prefill="onPrefill"
    />
    </div>
    <AppSheet v-model:open="changesOpen" :title="t('Changements')" wide full>
      <ChangesView v-if="changesOpen && pane" :pane-id="paneId" />
    </AppSheet>
    <input ref="attachInput" type="file" multiple hidden @change="attachFile">
  </section>
</template>
