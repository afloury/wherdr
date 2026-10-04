<script setup lang="ts">
// Card of an agent in the list: title, state and model ("working · claude ·
// opus 5.5"), folder
// (or worktree branch), preview of its last reply, and one-tap answers
// to its question.
// Space with several tabs or panes (`row`): a single card, named after the space,
// with its mini-map, the number of tabs / panes, and the state, preview and
// answers of its most urgent pane (`pane`). Tapping it opens the space.
// Coordinator's space (herdr-projects thread opened as a tab): the card stays
// the coordinator's, but shows the most urgent tab's state ("working · T-0008"),
// one state dot per tab next to "N TABS", and a tap opens the tab waiting for an answer.
import type { Pane } from '#shared/types'
import type { Row } from '#shared/spaces'
import { isCoordinator, stateSource, tabStates, waitingTab } from '#shared/projects'
import type { MenuItem } from '~/composables/useUi'
import { longPress } from '~/utils/longPress'

// `tag`: role in a herdr-projects project (coordinator, t-0018).
const props = defineProps<{ pane: Pane, tag?: string | null, row?: Row | null }>()
const space = computed(() => (props.row && props.row.kind === 'space' ? props.row : null))
// Pane whose state the card shows (a more urgent tab of a coordinator's space).
const statePane = computed(() => space.value?.state ?? props.pane)
const source = computed(() => (props.row ? stateSource(props.row) : null))
// One dot per tab, in order, for a coordinator's space with several tabs.
const dots = computed(() => (space.value && space.value.tabs.length > 1 && isCoordinator(space.value.lead) ? tabStates(space.value) : []))
const busy = ref(false)
const card = ref<HTMLElement | null>(null)
let pointerType = ''
let touchMenuOpenedAt = 0

const ws = computed(() => herdrState.value.workspaces.find(w => w.id === props.pane.workspace))
const branch = computed(() => ws.value?.branch || null)
const title = computed(() => spaceTitle(props.pane, ws.value))
const subtitle = computed(() => conversationSubtitle(props.pane, ws.value))
// Selection (computer): the pane being viewed, or for a space one of its panes / tabs.
const route = useRoute()
const selected = computed(() => {
  if (!space.value) return props.pane.id === curPane.value
  const tab = route.path.startsWith('/t/') ? String(route.params.tab || '') : null
  return space.value.panes.some(p => p.id === curPane.value || p.tab === tab)
})
const counts = computed(() => {
  const s = space.value
  if (!s) return ''
  const tabs = s.tabs.length > 1 ? tl(`${s.tabs.length} tabs`, `${s.tabs.length} onglets`) : ''
  return [tabs, tl(`${s.panes.length} panes`, `${s.panes.length} panes`)].filter(Boolean).join(' · ')
})
const where = computed(() => {
  const p = props.pane
  // Space: the pane the state and preview come from (and its tab if there are several).
  if (space.value) {
    const s = space.value
    return [s.tabs.length > 1 ? `${t('Tab')} ${s.leadTab.tab.label || s.leadTab.tab.number}` : '', subtitle.value].filter(Boolean).join(' · ')
  }
  return [subtitle.value, branch.value || shortPath(p.cwd)].filter(Boolean).join(' · ')
})
const prompt = computed(() => (props.pane.status === 'blocked' ? props.pane.prompt : undefined))
const quick = computed(() => quickChoices(prompt.value, 4))
// Recognized waiting screen (Codex hooks…): its title says better what is expected.
const screen = computed(() => knownScreen(props.pane))
const preview = computed(() => (screen.value && screenSummary(screen.value)) || (props.pane.menu && props.pane.status !== 'working' && menuSummary(props.pane.menu)) || (prompt.value ? prompt.value.question : props.pane.preview))
// Read / unread: only for an agent that has finished (ready).
const unread = computed(() => (space.value ? space.value.panes.filter(p => p.agent && p.status === 'done') : []))
const readItem = computed(() => {
  if (space.value) return unread.value.length ? { label: t('Mark as read'), icon: 'i-lucide-mail-open', run: () => readAll() } : null
  const p = props.pane
  if (!p.agent || (p.status !== 'done' && p.status !== 'idle')) return null
  return p.status === 'done'
    ? { label: t('Mark as read'), icon: 'i-lucide-mail-open', run: () => setRead(true) }
    : { label: t('Mark as unread'), icon: 'i-lucide-mail', run: () => setRead(false) }
})
async function readAll() {
  try {
    await Promise.all(unread.value.map(p => api('/api/seen', { pane_id: p.id, read: true })))
    haptic()
  } catch (err) { toast((err as Error).message, true) }
}
async function setRead(read: boolean) {
  try {
    await api('/api/seen', { pane_id: props.pane.id, read })
    haptic()
    // Unread while it is open alongside (computer): we close it,
    // otherwise it would immediately go back to "read".
    if (!read && curPane.value === props.pane.id) navigateTo('/')
  } catch (err) { toast((err as Error).message, true) }
}
const menuItems = computed<MenuItem[]>(() => space.value ? [
  ...(readItem.value ? [readItem.value, { kind: 'separator' as const }] : []),
  ...workspaceItems(space.value.workspace.id),
] : [
  ...(readItem.value ? [readItem.value, { kind: 'separator' as const }] : []),
  ...paneSpaceItems(props.pane),
  ...paneWorkspaceItems(props.pane),
  { kind: 'separator' },
  copyPaneIdItem(props.pane),
  { kind: 'separator' },
  {
    label: props.pane.agent
      ? tl(`Close this pane (stops ${kindLabel(props.pane.agent)})`, `Fermer ce pane (arrête ${kindLabel(props.pane.agent)})`)
      : t('Close this terminal'),
    icon: 'i-lucide-trash-2', danger: true, run: () => closePane(props.pane),
  },
])
const contextItems = computed(() => (sheetMenus.value ? [] : toDropdown(menuItems.value)))

// Touch or narrow screen: a still long press opens the card's menu as the
// bottom sheet (ReorderList arms its drag at 300 ms: moving then drags).
const lp = longPress({
  delay: 700,
  onPress: () => {
    if (card.value?.classList.contains('reorder-source')) return
    haptic()
    openMenu(menuItems.value, title.value)
  },
})
function down(e: PointerEvent) {
  pointerType = e.pointerType
  if (!sheetMenus.value || (e.target as Element | null)?.closest?.('button, a')) return
  lp.down(e)
}
// Right click with a mouse (narrow window, tablet trackpad): the same sheet. A
// finger's contextmenu (Android long press) is left to the long press.
function onContext(e: MouseEvent) {
  if (!sheetMenus.value) return
  e.preventDefault()
  if (pointerType === 'mouse') openMenu(menuItems.value, title.value)
}

function onContextOpen(open: boolean) {
  if (open && (pointerType === 'touch' || pointerType === 'pen')) touchMenuOpenedAt = Date.now()
}
function recentTouchMenu() { return Date.now() - touchMenuOpenedAt < 1000 || lp.swallowClick() }
function open() {
  if (recentTouchMenu()) return
  if (space.value) {
    const waiting = waitingTab(space.value)
    return waiting ? openTab(waiting) : openSpace(space.value.workspace.id, space.value.leadTab.tab.id)
  }
  haptic()
  navigateTo(`/a/${encodeURIComponent(props.pane.id)}`)
}
async function pick(i: number, label: string) {
  if (recentTouchMenu()) return
  busy.value = true
  const ok = await choose(props.pane.id, i, label)
  // Success: the buttons disappear with the question on the next state.
  if (!ok) busy.value = false
}
watch(() => props.pane.prompt, () => { busy.value = false })
</script>

<template>
  <UContextMenu :disabled="sheetMenus" :items="contextItems" :press-open-delay="700" :ui="{ content: 'hw-dropdown' }" @update:open="onContextOpen">
    <div
      ref="card" class="card" :class="[statusKey(statePane), { sel: selected, stale: paneStale(pane), 'space-card': space, 'state-from-tab': source }]" :data-pane="pane.id" :data-space="space?.workspace.id" :data-ws="pane.workspace"
      role="button" tabindex="0" @pointerdown="down" @pointermove="lp.move" @pointerup="lp.cancel" @pointercancel="lp.cancel"
      @contextmenu="onContext" @selectstart.prevent @click="open" @keydown.enter.self="open"
    >
      <span v-if="space" class="space-avatar" :title="counts"><TabMap :layout="space.leadTab.layout" :panes="space.leadTab.panes" :current="pane.id" /></span>
      <AgentAvatar v-else :agent="pane.agent" />
      <div class="card-main">
        <div class="card-title">
          {{ title }}
        </div>
        <div class="card-meta">
          <span v-if="tag" class="card-tag">{{ tag }}</span>
          <span v-if="space" class="card-count">{{ counts }}<span v-if="dots.length" class="card-tab-dots" :aria-label="tl('Tab states', 'États des onglets')"><i v-for="(d, i) in dots" :key="i" :class="d" /></span></span>
          <StatusPill :pane="statePane" :model="!source" :source="source" />
        </div>
        <div v-if="where" class="card-where">
          <UIcon v-if="space" name="i-lucide-corner-down-right" class="card-where-lead" /><UIcon v-else-if="branch" name="i-lucide-git-branch" />{{ where }}
        </div>
      </div>
      <div v-if="prompt?.detail" class="card-detail" :title="detailLine(prompt.detail)">
        <span class="card-detail-tool">{{ prompt.detail.tool }}</span><code>{{ detailLine(prompt.detail) }}</code>
      </div>
      <div v-if="preview" class="card-preview">{{ preview }}</div>
      <div v-if="quick.length" class="card-choices">
        <button
          v-for="o in quick" :key="o.i" type="button" :disabled="busy || !eventsOpen || offlineView || paneStale(pane)"
          @click.stop="pick(o.i, o.label)"
        >
          <span class="n">{{ o.i + 1 }}</span><span class="l">{{ o.label }}</span>
        </button>
      </div>
    </div>
  </UContextMenu>
</template>
