<script setup lang="ts">
// "Inbox" tab of the Project panel: the project's unhandled inbox items (what
// herdr-projects tells the coordinator: a thread's new report, a routine due,
// a machine out of reach…), oldest first as herdr-projects orders them.
// One action: Done, which runs `herdr-projects inbox done` for that item.
// Summaries may quote reports or GitHub: shown as plain text, never rendered.
// Re-read when the panel is refreshed (`tick`) or the board changes.
import type { ProjectBoard, ProjectThread } from '#shared/projectBoard'
import { type InboxItem, inboxThread } from '#shared/projectInbox'

const props = defineProps<{ paneId: string, board: ProjectBoard, tick: number }>()
const emit = defineEmits<{ count: [n: number], thread: [th: ProjectThread] }>()

const items = shallowRef<InboxItem[] | null>(null)
const total = ref(0)
const loading = ref(false)
const error = ref('')
let seq = 0
async function load() {
  if (offlineView.value) return
  const id = ++seq
  loading.value = true
  try {
    const r = await fetchProjectInbox(props.paneId)
    if (id !== seq) return
    items.value = r.items
    total.value = r.total
    error.value = ''
    emit('count', r.total)
  } catch (e) {
    if (id === seq) error.value = (e as Error).message
  } finally {
    if (id === seq) loading.value = false
  }
}
onMounted(load)
watch(() => [props.tick, props.board.version], load)
onUnmounted(() => { seq++ })

const KINDS: Record<string, [string, string]> = {
  'thread-state': ['Thread', 'i-lucide-git-branch'],
  'routine': [tl('Routine', 'Routine'), 'i-lucide-alarm-clock'],
  'pr': ['PR', 'i-lucide-git-pull-request'],
  'outage': [tl('Machine', 'Machine'), 'i-lucide-unplug'],
  'space': ['Space', 'i-lucide-layout-panel-left'],
}
const kindLabel = (it: InboxItem) => KINDS[it.kind]?.[0] || it.kind || tl('Notice', 'Avis')
const kindIcon = (it: InboxItem) => KINDS[it.kind]?.[1] || 'i-lucide-bell'
function threadOf(it: InboxItem): ProjectThread | undefined {
  const id = inboxThread(it)
  return id ? props.board.open.find(x => x.id === id) || props.board.resolved.find(x => x.id === id) : undefined
}
// A thread's title says more than its ID; anything else keeps its subject.
const title = (it: InboxItem) => threadOf(it)?.title || it.subject || kindLabel(it)
function meta(it: InboxItem) {
  const bits: string[] = []
  if (inboxThread(it)) bits.push(it.subject.toUpperCase())
  if (it.event) bits.push(it.event)
  const when = it.created && fmtWhen(it.created)
  if (when) bits.push(when)
  return bits.join(' · ')
}

// Long texts (a routine's prompt) stay folded until tapped.
const unfolded = ref(new Set<string>())
function toggle(id: string) {
  const next = new Set(unfolded.value)
  if (!next.delete(id)) next.add(id)
  unfolded.value = next
}

const marking = ref<string | null>(null)
async function done(it: InboxItem) {
  if (marking.value) return
  if (!eventsOpen.value || offlineView.value) return toast(tl('Inbox actions are unavailable offline', 'Actions de l’inbox indisponibles hors ligne'), true)
  marking.value = it.id
  haptic()
  try {
    await markInboxDone(props.paneId, it.id)
    items.value = (items.value || []).filter(x => x.id !== it.id)
    total.value = Math.max(0, total.value - 1)
    emit('count', total.value)
    toast(tl('Marked as handled', 'Marqué comme traité'))
  } catch (e) { toast((e as Error).message, true) }
  finally { marking.value = null }
}
</script>

<template>
  <div class="pi">
    <p v-if="error" class="pp-notice error" role="alert">
      <span>{{ tl('Inbox unavailable', 'Inbox indisponible') }} · <code>{{ error }}</code></span>
      <UButton size="xs" color="neutral" variant="outline" @click="load">{{ tl('Retry', 'Réessayer') }}</UButton>
    </p>
    <p v-if="items === null && loading" class="pp-notice"><span class="spinner" /> {{ tl('Reading the inbox…', 'Lecture de l’inbox…') }}</p>
    <template v-if="items">
      <p v-if="!items.length" class="pp-empty pi-none">{{ tl('Nothing waiting in the inbox', 'Rien en attente dans l’inbox') }}</p>
      <ul v-else class="pp-list pi-list">
        <li v-for="it in items" :key="it.id" class="pp-row">
          <div class="pp-card pi-card">
            <div class="pi-body">
              <!-- An item about a thread: its whole heading opens the thread (a
                   finger-sized target, not the title's single line). -->
              <component
                :is="threadOf(it) ? 'button' : 'div'" class="pi-head" :class="{ link: threadOf(it) }" :type="threadOf(it) ? 'button' : undefined"
                :aria-label="threadOf(it) ? tl(`Open the thread: ${title(it)}`, `Ouvrir le thread : ${title(it)}`) : undefined"
                @click="threadOf(it) && emit('thread', threadOf(it)!)"
              >
                <span class="pi-kind"><UIcon :name="kindIcon(it)" />{{ kindLabel(it) }}</span>
                <span class="pi-title">{{ title(it) }}</span>
                <span class="pp-meta pi-meta">{{ meta(it) }}</span>
              </component>
              <button
                v-if="it.summary || it.body" type="button" class="pi-fold"
                :aria-expanded="unfolded.has(it.id)" :aria-label="tl('Show or fold the text', 'Afficher ou replier le texte')" @click="toggle(it.id)"
              >
                <span class="pi-text" :class="{ open: unfolded.has(it.id) }">
                  <span v-if="it.summary">{{ it.summary }}</span>
                  <span v-if="it.body" class="pi-prompt">{{ it.body }}</span>
                </span>
              </button>
            </div>
            <UTooltip :text="tl('Mark as handled', 'Marquer comme traité')" :disabled="!desk">
              <UButton
                icon="i-lucide-check" color="neutral" variant="outline" class="pi-done" :loading="marking === it.id" :disabled="marking !== null"
                :aria-label="tl(`Mark as handled: ${title(it)}`, `Marquer comme traité : ${title(it)}`)" @click="done(it)"
              />
            </UTooltip>
          </div>
        </li>
      </ul>
      <p v-if="total > items.length" class="pp-empty pi-more">{{ tl(`${items.length} oldest of ${total} shown`, `${items.length} plus anciens affichés sur ${total}`) }}</p>
    </template>
  </div>
</template>
