<script setup lang="ts">
// Carte d'un agent dans la liste : titre, état et modèle (« working · claude ·
// opus 5.5 »), dossier
// (ou branche du worktree), aperçu de sa dernière réponse, et réponses en un
// tap à sa question.
// Space de plusieurs onglets ou panes (`row`) : une seule carte, au nom du space,
// avec sa mini-carte, le nombre d'onglets / panes, et l'état, l'aperçu et les
// réponses de son pane le plus urgent (`pane`). La toucher ouvre le space.
import type { Pane } from '#shared/types'
import type { Row } from '#shared/spaces'

// `tag` : rôle dans un projet herdr-projects (coordinateur, t-0018).
const props = defineProps<{ pane: Pane, tag?: string | null, row?: Row | null }>()
const space = computed(() => (props.row && props.row.kind === 'space' ? props.row : null))
const busy = ref(false)
let pointerType = ''
let touchMenuOpenedAt = 0

const ws = computed(() => herdrState.value.workspaces.find(w => w.id === props.pane.workspace))
const branch = computed(() => ws.value?.branch || null)
const title = computed(() => spaceTitle(props.pane, ws.value))
const subtitle = computed(() => conversationSubtitle(props.pane, ws.value))
// Sélection (ordinateur) : le pane regardé, ou pour un space un de ses panes / onglets.
const route = useRoute()
const selected = computed(() => {
  if (!space.value) return props.pane.id === curPane.value
  const tab = route.path.startsWith('/t/') ? String(route.params.tab || '') : null
  return space.value.panes.some(p => p.id === curPane.value || p.tab === tab)
})
const counts = computed(() => {
  const s = space.value
  if (!s) return ''
  const tabs = s.tabs.length > 1 ? tl(`${s.tabs.length} onglets`, `${s.tabs.length} tabs`) : ''
  return [tabs, tl(`${s.panes.length} panes`, `${s.panes.length} panes`)].filter(Boolean).join(' · ')
})
const where = computed(() => {
  const p = props.pane
  // Space : le pane dont viennent l'état et l'aperçu (et son onglet s'il y en a plusieurs).
  if (space.value) {
    const s = space.value
    return [s.tabs.length > 1 ? `${t('Onglet')} ${s.leadTab.tab.label || s.leadTab.tab.number}` : '', subtitle.value].filter(Boolean).join(' · ')
  }
  return [subtitle.value, branch.value || shortPath(p.cwd)].filter(Boolean).join(' · ')
})
const prompt = computed(() => (props.pane.status === 'blocked' ? props.pane.prompt : undefined))
// Écran d'attente reconnu (hooks de Codex…) : son titre dit mieux ce qui est attendu.
const screen = computed(() => knownScreen(props.pane))
const preview = computed(() => (screen.value && screenSummary(screen.value)) || (props.pane.menu && props.pane.status !== 'working' && menuSummary(props.pane.menu)) || (prompt.value ? prompt.value.question : props.pane.preview))
// Lu / non lu : seulement pour un agent qui a fini (prêt).
const unread = computed(() => (space.value ? space.value.panes.filter(p => p.agent && p.status === 'done') : []))
const readItem = computed(() => {
  if (space.value) return unread.value.length ? { label: t('Marquer comme lu'), icon: 'i-lucide-mail-open', run: () => readAll() } : null
  const p = props.pane
  if (!p.agent || (p.status !== 'done' && p.status !== 'idle')) return null
  return p.status === 'done'
    ? { label: t('Marquer comme lu'), icon: 'i-lucide-mail-open', run: () => setRead(true) }
    : { label: t('Marquer comme non lu'), icon: 'i-lucide-mail', run: () => setRead(false) }
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
    // Non lu alors qu'elle est ouverte à côté (ordinateur) : on la referme,
    // sinon elle repasserait aussitôt en « lu ».
    if (!read && curPane.value === props.pane.id) navigateTo('/')
  } catch (err) { toast((err as Error).message, true) }
}
const contextItems = computed(() => toDropdown(space.value ? [
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
      ? tl(`Fermer ce pane (arrête ${kindLabel(props.pane.agent)})`, `Close this pane (stops ${kindLabel(props.pane.agent)})`)
      : t('Fermer ce terminal'),
    icon: 'i-lucide-trash-2', danger: true, run: () => closePane(props.pane),
  },
]))

function onContextOpen(open: boolean) {
  if (open && (pointerType === 'touch' || pointerType === 'pen')) touchMenuOpenedAt = Date.now()
}
function recentTouchMenu() { return Date.now() - touchMenuOpenedAt < 1000 }
function open() {
  if (recentTouchMenu()) return
  if (space.value) return openSpace(space.value.workspace.id)
  haptic()
  navigateTo(`/a/${encodeURIComponent(props.pane.id)}`)
}
async function pick(i: number, label: string) {
  if (recentTouchMenu()) return
  busy.value = true
  const ok = await choose(props.pane.id, i, label)
  // Réussi : les boutons disparaissent avec la question au prochain état.
  if (!ok) busy.value = false
}
watch(() => props.pane.prompt, () => { busy.value = false })
</script>

<template>
  <UContextMenu :items="contextItems" :press-open-delay="700" :ui="{ content: 'hw-dropdown' }" @update:open="onContextOpen">
    <div
      class="card" :class="[statusKey(pane), { sel: selected, stale: paneStale(pane), 'space-card': space }]" :data-pane="pane.id" :data-space="space?.workspace.id" :data-ws="pane.workspace"
      role="button" tabindex="0" @pointerdown="pointerType = $event.pointerType" @selectstart.prevent @click="open" @keydown.enter.self="open"
    >
      <span v-if="space" class="space-avatar" :title="counts"><TabMap :layout="space.leadTab.layout" :panes="space.leadTab.panes" :current="pane.id" /></span>
      <AgentAvatar v-else :agent="pane.agent" />
      <div class="card-main">
        <div class="card-title">
          {{ title }}
        </div>
        <div class="card-meta">
          <span v-if="tag" class="card-tag">{{ tag }}</span>
          <span v-if="space" class="card-count">{{ counts }}</span>
          <StatusPill :pane="pane" model />
        </div>
        <div v-if="where" class="card-where">
          <UIcon v-if="space" name="i-lucide-corner-down-right" class="card-where-lead" /><UIcon v-else-if="branch" name="i-lucide-git-branch" />{{ where }}
        </div>
      </div>
      <div v-if="prompt?.detail" class="card-detail" :title="detailLine(prompt.detail)">
        <span class="card-detail-tool">{{ prompt.detail.tool }}</span><code>{{ detailLine(prompt.detail) }}</code>
      </div>
      <div v-if="preview" class="card-preview">{{ preview }}</div>
      <div v-if="prompt && prompt.options" class="card-choices">
        <button
          v-for="(o, i) in prompt.options.slice(0, 4)" :key="i" type="button" :disabled="busy || !eventsOpen || offlineView || paneStale(pane)"
          @click.stop="pick(i, o.label)"
        >
          <span class="n">{{ i + 1 }}</span><span class="l">{{ o.label }}</span>
        </button>
      </div>
    </div>
  </UContextMenu>
</template>
