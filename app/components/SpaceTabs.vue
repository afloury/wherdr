<script setup lang="ts">
// Onglets d'un space, au-dessus de l'en-tête quand il y en a plusieurs.
// Le « + » d'un onglet unique est dans l'en-tête de sa vue. Mini-carte pour
// un onglet de plusieurs panes, point d'état du pane le plus urgent sinon.
// L'onglet ouvert est mémorisé pour le space. Appui long (téléphone) ou clic
// droit (ordinateur) sur un onglet : ses options (renommer, nouvel onglet, fermer).
import { leadPane } from '#shared/spaces'
import { longPress } from '~/utils/longPress'

const props = defineProps<{ workspace: string, current: string }>()
const tabs = computed(() => spaceTabs(props.workspace).map((e) => {
  const lead = leadPane(e.panes)
  return {
    ...e,
    label: e.tab.label || String(e.tab.number),
    tone: lead && lead.agent ? statusKey(lead) : '',
    title: e.panes.map(p => paneTitle(p)).join(' · '),
  }
}))
watch(() => props.current, (id) => { if (id) noteTab(id) }, { immediate: true })

const menuTitle = (label: string) => `${t('Tab')} ${label}`
let pressed: { id: string, label: string } | null = null
const lp = longPress({
  onPress: () => {
    if (!pressed) return
    haptic()
    openMenu(tabItems(pressed.id), menuTitle(pressed.label))
  },
})
// Téléphone seulement : sur ordinateur, le menu contextuel s'en charge.
function down(e: PointerEvent, id: string, label: string) {
  if (desk.value) return
  pressed = { id, label }
  lp.down(e)
}
function pick(id: string) {
  if (lp.swallowClick() || id === props.current) return
  switchSpaceTab(id)
}
</script>

<template>
  <nav v-if="spaceTabControls(tabs.length).row" class="tab-chips space-tabs" :aria-label="t('Tabs')">
    <UContextMenu v-for="e in tabs" :key="e.tab.id" :disabled="!desk" :items="desk ? toDropdown(tabItems(e.tab.id)) : []" :ui="{ content: 'hw-dropdown' }">
      <button
        type="button" class="tab-chip" :class="e.tone" :title="e.title" :data-tab="e.tab.id"
        :aria-current="e.tab.id === current ? 'page' : undefined"
        @pointerdown="down($event, e.tab.id, e.label)" @pointermove="lp.move" @pointerup="lp.cancel" @pointercancel="lp.cancel"
        @contextmenu="!desk && $event.preventDefault()" @click="pick(e.tab.id)"
      >
        <TabMap v-if="e.panes.length > 1" :layout="e.layout" :panes="e.panes" />
        <i v-else class="tab-chip-dot" />
        <span class="tab-chip-label">{{ e.label }}</span>
      </button>
    </UContextMenu>
    <button type="button" class="tab-chip tab-add" :title="t('New tab')" :aria-label="t('New tab')" :disabled="offlineView" @click="newTab(workspace)">
      <UIcon name="i-lucide-plus" />
    </button>
  </nav>
</template>
