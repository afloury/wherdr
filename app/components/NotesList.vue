<script setup lang="ts">
// The notes (shared/notes.ts) under their filter, for NotesPanel.vue: each
// note's title and its few Markdown lines, read-only checkboxes and badges
// (NoteBadge.vue). Links: an in-app place opens in place (`leave` first),
// another note scrolls to it, a linked file does nothing yet.
import { h, render } from 'vue'
import { NOTES_FOLLOW, noteBadges, notesShown, scopeName, type Note } from '#shared/notes'
import { appRoute, isAppLink } from '#shared/appLinks'
import NoteBadge from './NoteBadge.vue'

const emit = defineEmits<{ leave: [] }>()
const router = useRouter()
const items = computed(() => [
  { label: tl('Follow group tab'), value: NOTES_FOLLOW },
  { label: tl('All'), value: 'all' },
  ...machineGroups.value.map(g => ({ label: g.name, value: g.id })),
])
// A group removed since it was picked: back to following the tab.
const filter = computed({
  get: () => (items.value.some(i => i.value === notesFilter.value) ? notesFilter.value : NOTES_FOLLOW),
  set: (v: string) => { notesFilter.value = v },
})
const shown = computed(() => notesShown(notes.value ?? [], filter.value, notesTabGroups.value))
const scopeOf = (n: Note) => (n.scope === 'all' ? tl('All') : scopeName(n.scope, machineGroups.value))

// Each badge leaves a mark in the text, a slot in the HTML, then mounts there.
const rendered = computed(() => shown.value.map((n) => {
  const { text, badges } = noteBadges(n.body, i => `@@note-badge-${i}@@`)
  const html = md(text, { plain: true }).replace(/@@note-badge-(\d+)@@/g, (_, i: string) => `<span class="note-badge-slot" data-i="${i}"></span>`)
  return { note: n, html, badges }
}))
const app = getCurrentInstance()!.appContext
const list = ref<HTMLElement | null>(null)
let slots: Element[] = []
function mountBadges() {
  for (const s of slots) render(null, s)
  slots = []
  for (const r of rendered.value) {
    for (const slot of list.value?.querySelectorAll(`#note-${r.note.id} .note-badge-slot`) ?? []) {
      const badge = r.badges[Number((slot as HTMLElement).dataset.i)]
      if (!badge) continue
      const v = h(NoteBadge, { badge })
      v.appContext = app
      render(v, slot)
      slots.push(slot)
    }
  }
}
watch(rendered, mountBadges, { flush: 'post' })
onMounted(mountBadges)
onBeforeUnmount(() => { for (const s of slots) render(null, s) })

function onClick(e: MouseEvent) {
  const a = (e.target as HTMLElement).closest('a')
  const href = a?.getAttribute('href') ?? ''
  if (!a || /^[a-z][a-z0-9+.-]*:/i.test(href)) return // a web address: its new tab
  e.preventDefault()
  if (isAppLink(href)) {
    emit('leave')
    router.push(appRoute(href))
    return
  }
  const note = /^([a-z0-9][a-z0-9-]*)\.md(?:#.*)?$/.exec(href)
  if (note) list.value?.querySelector(`#note-${note[1]}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
}
</script>

<template>
  <div class="notes-wrap">
    <USelect v-model="filter" :items="items" size="lg" class="notes-filter" :aria-label="tl('Notes shown')" data-testid="notes-filter" />
    <div ref="list" class="notes-list" @click="onClick">
      <article v-for="r in rendered" :id="`note-${r.note.id}`" :key="r.note.id" class="note" data-testid="note">
        <h3><span>{{ r.note.title }}</span><small class="mono-label">{{ scopeOf(r.note) }}</small></h3>
        <!-- eslint-disable-next-line vue/no-v-html -- sanitized by md() (utils/markdown.ts) -->
        <div class="note-body md" v-html="r.html" />
      </article>
      <p v-if="notes && !shown.length" class="muted notes-empty">{{ tl('No notes here. Agents write them: ask Alfred to add a reminder.') }}</p>
    </div>
  </div>
</template>
