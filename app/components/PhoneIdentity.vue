<script setup lang="ts">
import type { Pane, Workspace } from '#shared/types'
import { leadPane } from '#shared/spaces'

const props = defineProps<{ pane: Pane, workspace?: Workspace | null }>()
const emit = defineEmits<{ overview: [] }>()
const open = ref(false)
const entry = computed(() => tabOf(props.pane.tab))
const panes = computed(() => entry.value?.panes || [props.pane])
const tabs = computed(() => spaceTabs(props.pane.workspace))
const title = computed(() => props.pane.label || props.pane.name || paneOwnTitle(props.pane))
const kind = computed(() => kindLabel(props.pane.agent))
// No " · omp" under a pane already titled "omp".
const showKind = computed(() => Boolean(props.pane.agent) && title.value.toLocaleLowerCase() !== kind.value.toLocaleLowerCase())
const position = computed(() => `${panes.value.findIndex(p => p.id === props.pane.id) + 1}/${panes.value.length}`)
const host = computed(() => machineInfo(props.pane.machine))
const hostLabel = computed(() => machineName(props.pane.machine) || props.pane.machine || t('This machine'))
const disconnected = computed(() => host.value && host.value.status !== 'online')
const stateLabel = computed(() => disconnected.value
  ? (host.value?.status === 'connecting' ? t('Reconnecting…') : t('Offline')) : statusLabel(props.pane))
const tone = computed(() => disconnected.value ? 'blocked' : statusKey(props.pane))
const label = computed(() => [
  tl('Switch pane or tab', 'Changer de panneau ou d’onglet'), title.value, showKind.value ? kind.value : null, stateLabel.value,
  ...(panes.value.length > 1 ? [`${t('Pane')} ${position.value}`] : []), props.workspace?.label, hostLabel.value,
].filter(Boolean).join(', '))
const actions = computed(() => tabItems(props.pane.tab))
watch(() => props.pane.tab, id => noteTab(id), { immediate: true })
watch(() => props.pane.id, () => { open.value = false })

function visit(p: Pane) {
  open.value = false
  if (p.id !== props.pane.id) navigateTo(panePath(p.id))
}
function pickTab(id: string) {
  open.value = false
  if (id !== props.pane.tab) switchSpaceTab(id)
}
function run(item: MenuItem) {
  if (item.disabled) return
  open.value = false
  item.run?.()
}
function overview() { open.value = false; emit('overview') }
function tabStatus(e: typeof tabs.value[number]) {
  const lead = leadPane(e.panes)
  return lead ? statusLabel(lead) : t('Closed')
}
</script>

<template>
  <button type="button" class="phone-identity" :aria-label="label" aria-haspopup="dialog" :aria-expanded="open" @click="open = true">
    <span class="phone-identity-copy" aria-hidden="true">
      <span class="phone-identity-title">{{ title }}</span>
      <span class="phone-identity-meta"><span class="pill" :class="tone"><i />{{ stateLabel }}</span><template v-if="showKind"><span>·</span><span class="phone-identity-kind">{{ kind }}</span></template></span>
    </span>
    <UIcon v-if="paneNotificationsMuted(pane)" name="i-lucide-bell-off" mode="svg" class="phone-identity-muted" aria-hidden="true" />
    <span v-if="panes.length > 1" class="phone-identity-position" aria-hidden="true">{{ position }}</span>
    <UIcon name="i-lucide-chevron-down" mode="svg" class="phone-identity-chevron" aria-hidden="true" />
  </button>
  <AppSheet v-model:open="open" :title="tl('Panes and tabs', 'Panneaux et onglets')" hide-close>
    <div class="phone-identity-details">
      <p class="phone-identity-summary">{{ hostLabel }} · {{ workspace?.label || pane.workspace }}</p>
      <div class="menu">
        <p class="menu-group">{{ tl('Panes in this tab', 'Panneaux de cet onglet') }}</p>
        <button v-for="(p, i) in panes" :key="p.id" type="button" :aria-current="p.id === pane.id ? 'page' : undefined" @click="visit(p)">
          <UIcon :name="p.id === pane.id ? 'i-lucide-check' : 'i-lucide-panel-top'" class="menu-icon" />
          <span class="menu-text"><span>{{ p.label || p.name || paneOwnTitle(p) }}</span><span class="menu-sub"><span class="pill" :class="statusKey(p)"><i />{{ statusLabel(p) }}</span> · {{ i + 1 }}/{{ panes.length }}</span></span>
        </button>
        <p class="menu-group">{{ t('Tabs') }}</p>
        <button v-for="e in tabs" :key="e.tab.id" type="button" :aria-current="e.tab.id === pane.tab ? 'page' : undefined" @click="pickTab(e.tab.id)">
          <UIcon :name="e.tab.id === pane.tab ? 'i-lucide-check' : 'i-lucide-layers'" class="menu-icon" />
          <span class="menu-text"><span>{{ e.tab.label || e.tab.number }}</span><span class="menu-sub"><span class="pill" :class="leadPane(e.panes) ? statusKey(leadPane(e.panes)!) : 'inactive'"><i />{{ tabStatus(e) }}</span> · {{ e.panes.length === 1 ? tl('1 pane', '1 panneau') : tl(`${e.panes.length} panes`, `${e.panes.length} panneaux`) }}</span></span>
        </button>
        <div class="menu-sep" />
        <template v-for="(item, i) in actions" :key="i">
          <div v-if="item.kind === 'separator'" class="menu-sep" />
          <button v-else type="button" :class="{ danger: item.danger }" :disabled="item.disabled" @click="run(item)">
            <UIcon v-if="item.icon" :name="item.icon" class="menu-icon" />
            <span class="menu-text"><span>{{ item.label }}</span><span v-if="item.desc" class="menu-sub">{{ item.desc }}</span></span>
          </button>
        </template>
        <div class="menu-sep" />
        <button type="button" @click="overview"><UIcon name="i-lucide-panels-top-left" class="menu-icon" /><span class="menu-text"><span>{{ t('Tab overview') }}</span><span class="menu-sub">{{ tl('All panes of this tab side by side', 'Tous les panneaux de cet onglet côte à côte') }}</span></span></button>
      </div>
    </div>
  </AppSheet>
</template>

<style scoped>
.phone-identity { grid-area: head; display: flex; align-items: center; gap: 6px; min-width: 0; width: 100%; height: 44px; padding: 0 3px; text-align: left; color: var(--text); border-radius: 0; }
.phone-identity:active { background: var(--bg-2); }
.phone-identity:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
.phone-identity-copy { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.phone-identity-title { font-size: 14px; font-weight: 700; line-height: 1.2; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.phone-identity-meta { display: flex; align-items: center; gap: 5px; color: var(--muted); font: 500 11px/1.2 var(--mono); white-space: nowrap; }
.phone-identity-meta .pill, .menu-sub .pill { font-size: 11px; }
.phone-identity-position { flex: none; font: 500 .625rem/1 var(--mono); font-variant-numeric: tabular-nums; color: var(--muted); }
.phone-identity-chevron, .phone-identity-muted { width: 12px; height: 12px; flex: none; color: var(--muted); }
.phone-identity-summary { margin: 0 8px 12px; color: var(--muted); font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.phone-identity-details .menu-text > span { overflow-wrap: anywhere; }
.phone-identity-details button[aria-current="page"] { color: var(--accent); }
@container phone-header (max-width: 22em) { .phone-identity { gap: 4px; } }
@container phone-header (max-width: 18em) { .phone-identity-position { display: none; } }
@container phone-header (max-width: 15em) { .phone-identity-chevron { display: none; } }
</style>
