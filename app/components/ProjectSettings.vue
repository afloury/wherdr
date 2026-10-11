<script setup lang="ts">
// "Settings" tab of the Project panel: the project's settings as written in
// PROJECT.md (what `herdr-projects set` changes), with the plugin's default
// for a key the file does not set. Read-only: nothing here changes a setting,
// and the safety settings are not shown.
// Re-read when the panel is refreshed (`tick`) or the board changes.
import type { ProjectBoard } from '#shared/projectBoard'
import type { ProjectSettings, SettingKey } from '#shared/projectDocs'

const props = defineProps<{ paneId: string, board: ProjectBoard, tick: number }>()

const settings = shallowRef<ProjectSettings | null>(null)
const loading = ref(false)
const error = ref('')
let seq = 0
async function load() {
  if (offlineView.value) return
  const id = ++seq
  loading.value = true
  try {
    const r = await fetchProjectSettings(props.paneId)
    if (id !== seq) return
    settings.value = r.settings
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

const onOff = (v: boolean) => (v ? tl('On', 'Oui') : tl('Off', 'Non'))
// herdr-projects: `auto_resolve_days = 0` means never.
const days = (n: number) => (n === 0 ? tl('Never', 'Jamais') : tl(`${n} day${n === 1 ? '' : 's'}`, `${n} jour${n > 1 ? 's' : ''}`))
// Label, PROJECT.md key, value.
const rows = computed<{ key: SettingKey, label: string, toml: string, value: string }[]>(() => {
  const s = settings.value
  if (!s) return []
  return [
    { key: 'name', label: tl('Name', 'Nom'), toml: 'name', value: s.name || '—' },
    { key: 'goal', label: tl('Goal', 'Objectif'), toml: 'goal', value: s.goal || '—' },
    { key: 'coordinatorProfile', label: tl('Coordinator profile', 'Profil du coordinateur'), toml: 'coordinator_profile', value: s.coordinatorProfile },
    { key: 'threadProfile', label: tl('Thread profile', 'Profil des threads'), toml: 'thread_profile', value: s.threadProfile },
    { key: 'maxParallelThreads', label: tl('Parallel threads', 'Threads en parallèle'), toml: 'max_parallel_threads', value: String(s.maxParallelThreads) },
    { key: 'autoResolveDays', label: tl('Auto-resolve after', 'Clôture automatique après'), toml: 'auto_resolve_days', value: days(s.autoResolveDays) },
    { key: 'nudge', label: tl('Nudge the coordinator', 'Relancer le coordinateur'), toml: 'nudge', value: onOff(s.nudge) },
    { key: 'mute', label: tl('Mute notifications', 'Notifications en sourdine'), toml: 'mute', value: onOff(s.mute) },
  ]
})
</script>

<template>
  <div class="ps">
    <p v-if="error" class="pp-notice error" role="alert">
      <span>{{ tl('Settings unavailable', 'Réglages indisponibles') }} · <code>{{ error }}</code></span>
      <UButton size="xs" color="neutral" variant="outline" @click="load">{{ tl('Retry', 'Réessayer') }}</UButton>
    </p>
    <p v-if="settings === null && loading" class="pp-notice"><span class="spinner" /> {{ tl('Reading the settings…', 'Lecture des réglages…') }}</p>
    <template v-if="settings">
      <dl class="ps-list">
        <div v-for="r in rows" :key="r.key" class="ps-row">
          <dt><span class="ps-label">{{ r.label }}</span><code class="ps-key">{{ r.toml }}</code></dt>
          <dd>{{ r.value }}<span v-if="settings.defaults.includes(r.key)" class="ps-default">{{ tl('default', 'par défaut') }}</span></dd>
        </div>
      </dl>
      <h3 class="pt-label ps-head">{{ tl('Repositories', 'Dépôts') }} <span class="pp-count">{{ settings.repos.length }}</span></h3>
      <p v-if="!settings.repos.length" class="pp-empty ps-none">{{ tl('No repository: threads start as tabs in the project', 'Aucun dépôt : les threads démarrent en onglets du projet') }}</p>
      <ul v-else class="ps-repos">
        <li v-for="(repo, i) in settings.repos" :key="i"><code>{{ repo.path }}</code><span v-if="repo.machine" class="ps-default">{{ repo.machine }}</span></li>
      </ul>
      <p class="pp-empty ps-note">{{ tl('Read-only. Change a setting with “herdr-projects set”, or ask the coordinator.', 'Lecture seule. Un réglage se change avec « herdr-projects set », ou en le demandant au coordinateur.') }}</p>
    </template>
  </div>
</template>
