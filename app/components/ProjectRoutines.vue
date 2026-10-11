<script setup lang="ts">
// "Routines" tab of the Project panel: the project's routines as
// `herdr-projects routine list` prints them: name, schedule, enabled or not,
// kind (prompt only, or a command and its approval), last and next run.
// Read-only: approving, toggling and the safety settings stay in the terminal.
// Re-read when the panel is refreshed (`tick`) or the board changes.
import type { ProjectBoard } from '#shared/projectBoard'
import type { RoutineList } from '#shared/projectInbox'

const props = defineProps<{ paneId: string, board: ProjectBoard, tick: number }>()

const list = shallowRef<RoutineList | null>(null)
const loading = ref(false)
const error = ref('')
let seq = 0
async function load() {
  if (offlineView.value) return
  const id = ++seq
  loading.value = true
  try {
    const r = await fetchProjectRoutines(props.paneId)
    if (id !== seq) return
    list.value = r
    error.value = ''
  } catch (e) {
    if (id === seq) error.value = (e as Error).message
  } finally {
    if (id === seq) loading.value = false
  }
}
onMounted(load)
watch(() => [props.tick, props.board.version], load)
onUnmounted(() => { seq++ })
</script>

<template>
  <div class="pr">
    <p v-if="error" class="pp-notice error" role="alert">
      <span>{{ tl('Routines unavailable', 'Routines indisponibles') }} · <code>{{ error }}</code></span>
      <UButton size="xs" color="neutral" variant="outline" @click="load">{{ tl('Retry', 'Réessayer') }}</UButton>
    </p>
    <p v-if="list === null && loading" class="pp-notice"><span class="spinner" /> {{ tl('Reading the routines…', 'Lecture des routines…') }}</p>
    <template v-if="list">
      <p v-if="!list.routines.length && !list.broken.length" class="pp-empty pi-none">{{ tl('No routine in this project', 'Aucune routine dans ce projet') }}</p>
      <ul v-else class="pp-list pi-list">
        <li v-for="r in list.routines" :key="r.name" class="pp-row">
          <div class="pp-card pr-card" :class="{ off: !r.enabled }">
            <div class="pr-head">
              <span class="pr-name">{{ r.name }}</span>
              <span class="pill" :class="r.enabled ? 'done' : 'idle'"><i />{{ r.enabled ? tl('Enabled', 'Activée') : tl('Disabled', 'Désactivée') }}</span>
            </div>
            <span class="pr-schedule"><UIcon name="i-lucide-alarm-clock" />{{ r.schedule }}</span>
            <dl class="pr-facts">
              <div v-if="r.kind"><dt>{{ tl('Kind', 'Type') }}</dt><dd>{{ r.kind }}</dd></div>
              <div v-for="(w, i) in r.when" :key="i"><dd class="wide">{{ w }}</dd></div>
            </dl>
          </div>
        </li>
        <li v-for="b in list.broken" :key="b.file" class="pp-row">
          <div class="pp-card pr-card broken">
            <div class="pr-head"><span class="pr-name">{{ b.file }}</span></div>
            <p class="pr-error">{{ b.error }}</p>
          </div>
        </li>
      </ul>
      <p v-if="list.routines.length || list.broken.length" class="pp-empty pi-more">{{ tl('Read-only. Routines are approved and switched from the terminal.', 'Lecture seule. Les routines s’approuvent et s’activent depuis le terminal.') }}</p>
    </template>
  </div>
</template>
