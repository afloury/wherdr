<script setup lang="ts">
import { desk as desktop } from '~/composables/useHerdr'
// Board settings of one machine (herdr-projects 1.x `show`, `set`, `unset`), in
// the Board's side panel on a computer and full screen on a phone, as a task's
// panel. Opened from the Board's ⚙ (the machine shown, or a choice among the
// machines of "All" or a group), a machine bar item's menu, or a repo heading
// (its entry, on the Repositories tab).
// Three tabs: Machine (the board's own settings), Defaults (the user's values
// for every task), Repositories (one repo's entry: what differs there). Each
// row says where its value comes from; ↺ goes back to the inherited value.
// After each change the settings shown are those herdr-projects answers with,
// read again (never what was asked). A refusal is shown as it is said.
import { BOARD_SETTINGS_TABS, type BoardSettings, type BoardSettingsTab, differsForRepo, settingWarning, themedRows } from '#shared/boardSettings'
import type { TaskSetting } from '#shared/taskSettings'
import { boardSettingThemeLabel, boardSettingsTabHint, boardSettingsTabLabel, settingWarningText } from '~/utils/boardSettings'
import { panelWidthCss, readPanelWidth } from '~/utils/sideWidth'

export interface SettingsTarget { machines: string[], repo?: string, machine?: string }
const props = defineProps<{ overlay?: boolean, target: SettingsTarget, repos: Record<string, string[]>, machineLabel: (machine: string) => string, reachable: (machine: string) => boolean }>()
const desk = computed(() => desktop.value && !props.overlay)
const emit = defineEmits<{ close: [], changed: [machine: string] }>()

const machine = ref<string | null>(props.target.machine ?? (props.target.machines.length === 1 ? props.target.machines[0]! : null))
const tab = ref<BoardSettingsTab>(props.target.repo ? 'repo' : 'machine')
const repoList = computed(() => {
  const m = machine.value
  const known = m === null ? [] : props.repos[m] ?? []
  return props.target.repo && !known.includes(props.target.repo) ? [props.target.repo, ...known] : known
})
const repo = ref(props.target.repo ?? '')
watch(repoList, (list) => { if (!list.includes(repo.value)) repo.value = list[0] ?? '' }, { immediate: true })
const onlyDiff = ref(true)
// The row being saved, and each row's last refusal (herdr-projects' words).
const busy = ref('')
const rowErrors = ref<Record<string, string>>({})

// The user's settings (Machine and Defaults) and one repo's entry, each read when shown.
const mine = ref<BoardSettings | null>(null)
const entry = ref<BoardSettings | null>(null)
const loading = ref(false)
const error = ref('')
const shownRepo = computed(() => (tab.value === 'repo' ? repo.value : ''))
const data = computed(() => (tab.value === 'repo' ? (entry.value?.repo === repo.value ? entry.value : null) : mine.value))
const offline = computed(() => machine.value === null || !props.reachable(machine.value) || offlineView.value)
let seq = 0
async function load() {
  const m = machine.value
  if (m === null || offline.value) return
  if (tab.value === 'repo' && !repo.value) return
  const want = shownRepo.value
  const n = ++seq
  loading.value = true
  error.value = ''
  try {
    const r = await api<BoardSettings>(`/api/tasks/board-settings?machine=${encodeURIComponent(m)}${want ? `&repo=${encodeURIComponent(want)}` : ''}`)
    if (n !== seq) return
    if (want) entry.value = r
    else mine.value = r
  } catch (e) { if (n === seq) error.value = (e as Error).message }
  finally { if (n === seq) loading.value = false }
}
watch([machine, tab, repo, offline], () => { rowErrors.value = {}; if (!data.value) load() }, { immediate: true })
watch(machine, () => { mine.value = null; entry.value = null }, { flush: 'sync' })

const rows = computed<TaskSetting[]>(() => data.value?.settings ?? [])
const groups = computed(() => {
  const all = themedRows(rows.value, tab.value)
  if (tab.value !== 'repo' || !onlyDiff.value) return all
  return all.map(g => ({ ...g, rows: g.rows.filter(differsForRepo) })).filter(g => g.rows.length)
})
const hiddenCount = computed(() => (tab.value === 'repo' && onlyDiff.value ? themedRows(rows.value, 'repo').reduce((n, g) => n + g.rows.filter(r => !differsForRepo(r)).length, 0) : 0))

// ------------------------------------------------------------ a change
async function change(row: TaskSetting, value: string | null): Promise<boolean> {
  const m = machine.value
  if (m === null || busy.value || offline.value) return false
  const where = shownRepo.value
  const warning = settingWarning(row.name, value)
  if (warning) {
    const ok = await askConfirm(settingWarningText(warning, where), value === null ? tl('Go back', 'Revenir') : tl('Change', 'Modifier'), 'error',
      value === null ? `herdr-projects unset ${row.name}${where ? ` --repo ${where}` : ''}` : `herdr-projects set ${row.name} ${value}${where ? ` --repo ${where}` : ''}`)
    if (!ok) return false
  }
  busy.value = row.name
  const { [row.name]: _, ...others } = rowErrors.value
  rowErrors.value = others
  try {
    const r = await api<BoardSettings & { msg: string }>('/api/tasks/board-settings', { machine: m, name: row.name, repo: where, ...(value === null ? { unset: true } : { value }) })
    if (machine.value !== m) return true
    if (where) entry.value = r
    else { mine.value = r; entry.value = null }
    haptic()
    toast(r.msg || tl('Saved', 'Enregistré'))
    emit('changed', m)
    return true
  } catch (e) {
    rowErrors.value = { ...rowErrors.value, [row.name]: (e as Error).message }
    // What herdr-projects has now, whatever went wrong.
    if (machine.value === m && shownRepo.value === where) load()
    return false
  } finally { busy.value = '' }
}

// ------------------------------------------------------------ panel
const title = computed(() => (machine.value === null ? tl('Board settings', 'Réglages du board') : `${tl('Board settings', 'Réglages du board')} · ${props.machineLabel(machine.value)}`))
function onKey(e: KeyboardEvent) {
  if (e.key !== 'Escape' || !desktop.value || e.defaultPrevented) return
  if (document.querySelector('.hw-sheet')) return
  emit('close')
}
onMounted(() => {
  window.addEventListener('keydown', onKey)
  document.documentElement.style.setProperty('--board-panel-w', panelWidthCss(readPanelWidth()))
})
onUnmounted(() => {
  window.removeEventListener('keydown', onKey)
  document.documentElement.style.removeProperty('--board-panel-w')
})
const style = computed(() => (!desk.value && kbOpen.value ? { height: `${vvHeight.value}px`, top: `${vvTop.value}px` } : {}))
const repoItems = computed(() => repoList.value.map(r => ({ label: r, value: r })))
</script>

<template>
  <aside class="board-panel board-settings" :class="{ desk }" :style="style" data-kind="settings" :aria-label="title">
    <header class="board-panel-head">
      <UButton v-if="!desk" icon="i-lucide-chevron-left" color="neutral" variant="ghost" size="lg" class="icon-btn board-panel-back" :aria-label="tl('Back to the Board', 'Retour au Board')" @click="emit('close')" />
      <div class="board-panel-who">
        <p class="board-panel-path">
          <span class="board-panel-machine"><UIcon name="i-lucide-server" />{{ machine === null ? tl('Choose a machine', 'Choisis une machine') : machineLabel(machine) }}</span>
          <span v-if="tab === 'repo' && repo && machine !== null" class="board-panel-repo">{{ repo }}</span>
        </p>
        <h2 class="board-panel-name"><UIcon name="i-lucide-settings" class="board-settings-icon" /><span class="board-panel-title">{{ title }}</span></h2>
      </div>
      <UButton
        v-if="machine !== null && target.machines.length > 1" color="neutral" variant="outline" size="sm" class="board-settings-switch"
        icon="i-lucide-arrow-left-right" :aria-label="tl('Another machine', 'Autre machine')" @click="machine = null"
      ><span class="board-settings-switch-label">{{ tl('Machine', 'Machine') }}</span></UButton>
      <UButton v-if="desk" icon="i-lucide-x" color="neutral" variant="ghost" size="md" class="icon-btn board-panel-close" :aria-label="t('Close')" @click="emit('close')" />
    </header>

    <!-- "All" or a group: which machine's settings. -->
    <div v-if="machine === null" class="board-settings-body">
      <p class="board-settings-hint">{{ tl('Each machine has its own board settings. Which one?', 'Chaque machine a ses propres réglages du board. Laquelle ?') }}</p>
      <ul class="board-settings-machines">
        <li v-for="m in target.machines" :key="m || 'local'">
          <button type="button" :disabled="!reachable(m)" @click="machine = m">
            <UIcon name="i-lucide-server" /><span>{{ machineLabel(m) }}</span>
            <small v-if="!reachable(m)">{{ tl('cannot be read now', 'illisible pour l’instant') }}</small>
            <UIcon name="i-lucide-chevron-right" class="board-settings-go" />
          </button>
        </li>
      </ul>
      <p v-if="!target.machines.length" class="board-empty">{{ tl('No machine with a board here.', 'Aucune machine avec un board ici.') }}</p>
    </div>

    <template v-else>
      <nav class="board-panel-tabs" :aria-label="tl('Board settings', 'Réglages du board')">
        <button v-for="x in BOARD_SETTINGS_TABS" :key="x" type="button" :class="{ on: tab === x }" :aria-pressed="tab === x" @click="tab = x">{{ boardSettingsTabLabel(x) }}</button>
      </nav>
      <div class="board-settings-body">
        <p class="board-settings-hint">{{ boardSettingsTabHint(tab) }}</p>
        <div v-if="tab === 'repo'" class="board-settings-repo">
          <USelect v-if="repoItems.length" v-model="repo" :items="repoItems" size="md" class="board-settings-repo-pick" :aria-label="tl('Repository', 'Dépôt')" />
          <label v-if="repoItems.length" class="board-settings-diff"><input v-model="onlyDiff" type="checkbox">{{ tl('Only what differs', 'Seulement ce qui diffère') }}</label>
          <p v-else class="board-empty">{{ tl('No repository on this board yet.', 'Aucun dépôt sur ce board pour l’instant.') }}</p>
        </div>
        <p v-if="offline" class="board-note" role="status">{{ tl('Machine offline. Settings cannot be read.', 'Machine hors ligne. Impossible de lire les réglages.') }}</p>
        <p v-else-if="loading && !data" class="board-empty" role="status">{{ t('Loading…') }}</p>
        <div v-else-if="error && !data" role="alert" class="board-note error">
          <p>{{ tl('Could not read settings', 'Impossible de lire les réglages') }} · {{ error }}</p>
          <UButton color="neutral" variant="outline" @click="load">{{ tl('Retry', 'Réessayer') }}</UButton>
        </div>
        <template v-else-if="data">
          <p v-for="(problem, index) in data.problems" :key="index" class="board-note error" role="alert">{{ problem }}</p>
          <p v-if="tab === 'repo' && onlyDiff && !groups.length" class="board-empty">{{ tl('Nothing differs here: this repository follows your defaults.', 'Rien ne diffère ici : ce dépôt suit tes valeurs par défaut.') }}</p>
          <section v-for="g in groups" :key="g.theme" class="board-settings-group" :data-theme="g.theme">
            <h3>{{ boardSettingThemeLabel(g.theme) }}</h3>
            <BoardSettingRow
              v-for="row in g.rows" :key="`${shownRepo}|${row.name}`" :row="row" :rows="rows" :machine="machine" :repo="shownRepo" :agents="data.agents"
              :busy="busy === row.name" :disabled="Boolean(busy && busy !== row.name) || offline" :error="rowErrors[row.name]" :change="(v: string | null) => change(row, v)"
            />
          </section>
          <button v-if="hiddenCount" type="button" class="board-more" @click="onlyDiff = false">{{ tl(`Show the ${hiddenCount} inherited settings`, `Afficher les ${hiddenCount} réglages hérités`) }}</button>
        </template>
      </div>
    </template>
  </aside>
</template>

<style scoped>
.board-settings-icon { flex: none; align-self: center; width: 15px; height: 15px; color: var(--accent); }
.board-panel-name { font-size: inherit; }
.board-settings-switch { flex: none; border-radius: 0; font: 600 10.5px/1 var(--mono); letter-spacing: .1em; text-transform: uppercase; }
@media (max-width: 420px) { .board-settings-switch-label { display: none; } }
.board-settings-body { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; -webkit-overflow-scrolling: touch; padding: 12px 16px calc(var(--safe-bottom) + 24px); }
.board-settings-hint { margin: 0 0 12px; font-size: 12.5px; color: var(--muted); }
.board-settings-machines { list-style: none; margin: 0; padding: 0; border-top: 1px solid var(--line); }
.board-settings-machines button { width: 100%; display: flex; align-items: center; gap: 10px; padding: 14px 4px; border-bottom: 1px solid var(--line); text-align: left; font-size: 14px; color: var(--text); }
.board-settings-machines button:disabled { color: var(--muted); }
.board-settings-machines button span { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.board-settings-machines small { font: 500 10.5px/1.2 var(--mono); text-transform: uppercase; color: var(--muted); }
.board-settings-go { color: var(--muted); }
.board-settings-repo { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 16px; margin-bottom: 8px; }
.board-settings-repo-pick { min-width: 180px; max-width: 100%; }
.board-settings-diff { display: inline-flex; align-items: center; gap: 6px; font: 600 10.5px/1.2 var(--mono); letter-spacing: .1em; text-transform: uppercase; color: var(--muted); }
.board-settings-diff input { accent-color: var(--accent); }
.board-settings-group { margin-top: 18px; min-width: 0; }
.board-settings-group h3 { margin: 0 0 6px; font: 600 11px/1.2 var(--mono); letter-spacing: .14em; text-transform: uppercase; color: var(--muted); }
</style>
