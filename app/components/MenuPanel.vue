<script setup lang="ts">
// Claude Code interactive menu open (/resume, /mcp, /hooks…): its title,
// its search, its entries (the one under the cursor highlighted) and the keys
// of its legend. A click on an entry moves the cursor there then presses
// Enter; nothing is sent without a gesture. Menu without a recognized entry: fallback to
// the terminal.
import type { InteractiveMenu, WaitAction } from '#shared/types'
import { clickMovesOnly } from '#shared/menuScreen'

const props = defineProps<{ paneId: string, menu: InteractiveMenu, keys?: boolean }>()
const emit = defineEmits<{ terminal: [] }>()
const busy = ref(false)
const cursor = ref(props.menu.cursor)
const identity = computed(() => cursor.value === null ? props.menu.identity : props.menu.items[cursor.value]?.identity)
const listRef = ref<HTMLElement | null>(null)
// Entry under the cursor visible (long list: /model…).
const showCursor = () => nextTick(() => listRef.value?.querySelector('.cur')?.scrollIntoView({ block: 'nearest' }))
// Arrow keys sent and not answered yet (see the keyboard below).
let navPending = 0
// A new reading of the menu takes the cursor back from the server. While an
// arrow is on its way, the server keeps sending the same menu (its state is
// broadcast whenever anything moves, another agent included): one whose
// cursor has not moved yet keeps the cursor the arrow already painted.
watch(() => props.menu, (m, old) => {
  busy.value = false
  if (navPending && old && m.cursor === old.cursor && m.identity === old.identity) return
  cursor.value = m.cursor
  showCursor()
})
onMounted(showCursor)

const disabled = computed(() => busy.value || props.menu.unavailable || !eventsOpen.value || offlineView.value)
// A click on an entry only moves the cursor there (Enter = "set as default"…).
const moveOnly = computed(() => clickMovesOnly(props.menu))
// With clickable entries that confirm, Enter is redundant.
const actions = computed(() => props.menu.actions.filter(a => !(a.key === 'enter' && props.menu.cursor !== null && !moveOnly.value)))
// No cursor while a search is typed: the entries stay listed (a click goes ↓ first).
const known = computed(() => props.menu.items.length > 0)

async function pick(i: number, label: string) {
  busy.value = true
  if (!(await menuAction(props.paneId, { op: 'select', index: i, label }, props.menu.items[i]?.identity))) busy.value = false
}
async function press(a: WaitAction) {
  busy.value = true
  if (!(await menuAction(props.paneId, { op: 'key', key: a.key, label: a.label }, identity.value))) busy.value = false
}

// Search: the text goes out (letter by letter, on the server) once typing settles.
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
  if (text !== (props.menu.search || '')) await menuAction(props.paneId, { op: 'search', text }, props.menu.identity)
  typing.value = false
}
onBeforeUnmount(() => { if (timer) clearTimeout(timer) })

// Keyboard (computer, active view): ↑ ↓ Enter Escape go to the terminal, the
// card follows the re-read screen. Enter only if it simply confirms the entry.
// Ctrl+letters of the legend (/resume: Ctrl+A) press the matching button,
// even on a list with no entry (a project without conversations).
const searchRef = ref<HTMLInputElement | null>(null)
const esc = computed(() => props.menu.actions.some(a => a.key === 'esc'))
const ctrl = computed(() => props.menu.actions.filter(a => /^ctrl\+[a-z]$/.test(a.key)).map(a => a.key))
const keyboard = computed(() => Boolean(props.keys && desk.value && known.value && !disabled.value))
useCardKeys(() => Boolean(props.keys && desk.value && !disabled.value && (known.value || ctrl.value.length)), () => ({ digits: 0, enter: !moveOnly.value, own: searchRef.value, ctrl: ctrl.value, nav: keyboard.value }), (k) => {
  if (k.kind === 'ctrl') {
    const a = props.menu.actions.find(x => x.key === k.key)
    if (a) press(a)
    return
  }
  if (k.kind !== 'nav' || (k.key === 'esc' && !esc.value)) return
  if (k.key === 'up' || k.key === 'down') {
    // Predict only entries already displayed, so a rapid arrow + Enter keeps
    // the identity of the intended target without trusting an unseen row.
    const entries = props.menu.items.map((item, i) => item.header ? -1 : i).filter(i => i >= 0)
    const at = entries.indexOf(cursor.value ?? -1)
    cursor.value = entries[at + (k.key === 'down' ? 1 : -1)] ?? cursor.value
    showCursor()
  }
  navPending++
  navKey(props.paneId, k.key, identity.value).then(ok => {
    navPending--
    if (!ok) { cursor.value = props.menu.cursor; showCursor() }
  })
})
</script>

<template>
  <div class="choices choices-menu">
    <p class="eyebrow choices-eyebrow"><i />{{ t('Your turn') }}<span class="menu-kind">{{ t('Interactive menu') }}</span></p>
    <p v-if="menu.unavailable" class="choices-note" role="status">{{ tl('Screen read failed. Retrying…', 'Lecture de l’écran impossible. Nouvelle tentative…') }}</p>
    <p v-if="menu.title" class="choices-q">{{ menu.title }}</p>
    <p v-if="known && menu.lines.length" class="choices-note">{{ menu.lines[0] }}</p>
    <p v-if="known && moveOnly" class="choices-note">{{ tl('Tap an entry to move the cursor there, then confirm with a button below.', 'Toucher une entrée y place le curseur ; valide ensuite avec un bouton ci-dessous.') }}</p>
    <form v-if="menu.search !== null" class="menu-search" @submit.prevent="sendSearch">
      <UIcon name="i-lucide-search" aria-hidden="true" />
      <input
        ref="searchRef" v-model="query" type="search" :placeholder="t('Search…')" :aria-label="t('Search the menu')"
        enterkeyhint="search" autocomplete="off" autocapitalize="off" spellcheck="false" :disabled="disabled" @input="onInput"
      >
    </form>
    <div v-if="known" ref="listRef" class="choices-list menu-list">
      <template v-for="(o, i) in menu.items" :key="i">
        <p v-if="o.header" class="menu-group">{{ o.label }}</p>
        <button v-else type="button" :class="{ cur: i === cursor }" :aria-current="i === cursor ? 'true' : undefined" :disabled="disabled" @click="pick(i, o.label)">
          <span class="n" aria-hidden="true">{{ i === cursor ? '❯' : '' }}</span><span class="l">{{ o.label }}<small v-if="o.hint">{{ o.hint }}</small></span>
        </button>
      </template>
      <p v-if="menu.more" class="menu-more">{{ menu.more }}</p>
    </div>
    <template v-else>
      <pre v-if="menu.lines.length" class="choices-screen-text wrap">{{ menu.lines.join('\n') }}</pre>
      <p class="choices-note">{{ tl('Interactive menu open: pick its entries in the terminal.', 'Menu interactif en cours : ses entrées se choisissent dans le terminal.') }}</p>
    </template>
    <div class="choices-keys">
      <button v-for="a in actions" :key="a.key + a.label" type="button" :disabled="disabled" @click="press(a)">
        {{ screenActionText(a) }}<kbd>{{ screenKeyName(a.key) }}</kbd>
      </button>
      <span v-if="keyboard" class="card-kbd" aria-hidden="true"><kbd>↑↓</kbd><kbd v-if="!moveOnly">{{ screenKeyName('enter') }}</kbd></span>
      <button type="button" class="menu-term" @click="emit('terminal')">
        <UIcon name="i-lucide-square-terminal" aria-hidden="true" />{{ t('View terminal') }}
      </button>
    </div>
  </div>
</template>
