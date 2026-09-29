<script setup lang="ts">
// Menu interactif de Claude Code ouvert (/resume, /mcp, /hooks…) : son titre,
// sa recherche, ses entrées (celle sous le curseur en évidence) et les touches
// de sa légende. Un clic sur une entrée y amène le curseur puis appuie sur
// Entrée ; rien n'est envoyé sans geste. Menu sans entrée reconnue : repli vers
// le terminal.
import type { InteractiveMenu, WaitAction } from '#shared/types'
import { clickMovesOnly } from '#shared/menuScreen'

const props = defineProps<{ paneId: string, menu: InteractiveMenu }>()
const emit = defineEmits<{ terminal: [] }>()
const busy = ref(false)
const listRef = ref<HTMLElement | null>(null)
// Entrée sous le curseur visible (liste longue : /model…).
const showCursor = () => nextTick(() => listRef.value?.querySelector('.cur')?.scrollIntoView({ block: 'nearest' }))
watch(() => props.menu, () => { busy.value = false; showCursor() })
onMounted(showCursor)

const disabled = computed(() => busy.value || !eventsOpen.value || offlineView.value)
// Un clic sur une entrée n'y amène que le curseur (Entrée = « set as default »…).
const moveOnly = computed(() => clickMovesOnly(props.menu))
// Avec des entrées cliquables qui valident, Entrée fait doublon.
const actions = computed(() => props.menu.actions.filter(a => !(a.key === 'enter' && props.menu.cursor !== null && !moveOnly.value)))
const known = computed(() => props.menu.cursor !== null && props.menu.items.length > 0)

async function pick(i: number, label: string) {
  busy.value = true
  if (!(await menuAction(props.paneId, { op: 'select', index: i, label }))) busy.value = false
}
async function press(a: WaitAction) {
  busy.value = true
  if (!(await menuAction(props.paneId, { op: 'key', key: a.key, label: a.label }))) busy.value = false
}

// Recherche : le texte part (lettre par lettre, côté serveur) une fois la frappe posée.
const query = ref(props.menu.search || '')
const typing = ref(false)
watch(() => props.menu.search, (s) => { if (!typing.value) query.value = s || '' })
let timer: ReturnType<typeof setTimeout> | null = null
function onInput() {
  typing.value = true
  if (timer) clearTimeout(timer)
  timer = setTimeout(sendSearch, 450)
}
async function sendSearch() {
  if (timer) { clearTimeout(timer); timer = null }
  const text = query.value
  if (text !== (props.menu.search || '')) await menuAction(props.paneId, { op: 'search', text })
  typing.value = false
}
onBeforeUnmount(() => { if (timer) clearTimeout(timer) })
</script>

<template>
  <div class="choices choices-menu">
    <p class="eyebrow choices-eyebrow"><i />{{ t('À toi') }}<span class="menu-kind">{{ t('Menu interactif') }}</span></p>
    <p v-if="menu.title" class="choices-q">{{ menu.title }}</p>
    <p v-if="known && menu.lines.length" class="choices-note">{{ menu.lines[0] }}</p>
    <p v-if="known && moveOnly" class="choices-note">{{ tl('Toucher une entrée y place le curseur ; valide ensuite avec un bouton ci-dessous.', 'Tap an entry to move the cursor there, then confirm with a button below.') }}</p>
    <form v-if="menu.search !== null" class="menu-search" @submit.prevent="sendSearch">
      <UIcon name="i-lucide-search" aria-hidden="true" />
      <input
        v-model="query" type="search" :placeholder="t('Rechercher…')" :aria-label="t('Rechercher dans le menu')"
        enterkeyhint="search" autocomplete="off" autocapitalize="off" spellcheck="false" :disabled="!eventsOpen || offlineView" @input="onInput"
      >
    </form>
    <div v-if="known" ref="listRef" class="choices-list menu-list">
      <template v-for="(o, i) in menu.items" :key="i">
        <p v-if="o.header" class="menu-group">{{ o.label }}</p>
        <button v-else type="button" :class="{ cur: i === menu.cursor }" :aria-current="i === menu.cursor ? 'true' : undefined" :disabled="disabled" @click="pick(i, o.label)">
          <span class="n" aria-hidden="true">{{ i === menu.cursor ? '❯' : '' }}</span><span class="l">{{ o.label }}<small v-if="o.hint">{{ o.hint }}</small></span>
        </button>
      </template>
      <p v-if="menu.more" class="menu-more">{{ menu.more }}</p>
    </div>
    <template v-else>
      <pre v-if="menu.lines.length" class="choices-screen-text wrap">{{ menu.lines.join('\n') }}</pre>
      <p class="choices-note">{{ tl('Menu interactif en cours : ses entrées se choisissent dans le terminal.', 'Interactive menu open: pick its entries in the terminal.') }}</p>
    </template>
    <div class="choices-keys">
      <button v-for="a in actions" :key="a.key + a.label" type="button" :disabled="disabled" @click="press(a)">
        {{ screenActionText(a) }}<kbd>{{ screenKeyName(a.key) }}</kbd>
      </button>
      <button type="button" class="menu-term" @click="emit('terminal')">
        <UIcon name="i-lucide-square-terminal" aria-hidden="true" />{{ t('Voir le terminal') }}
      </button>
    </div>
  </div>
</template>
