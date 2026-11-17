<script setup lang="ts">
// Settings › Projects: the project management switch, then the projects (a git
// folder on a machine herdr-core reaches). A row opens the project's sheet
// (ProjectSheet), its key and tab in the URL (`?project=WHR&tab=general`).
// Add project opens the New sheet on its Project form (NewProjectForm), as the
// sidebar's New › Project does (the `projects.setup` target: the switch while projects are off); Add workspace, WorkspaceAddSheet. A row whose coordinator
// proposes a workflow change says so (reviewed on the sheet's Workflow tab).
// Template library opens TemplateLibrary (`?library=1`).
// Off, the server refuses every change but the switch. Until the overview is
// read: skeletons (SettingsSkeleton), not an off switch and no project; a failed
// read shows its error and Try again.
// Above the list, a tab filter as the sidebar's home tabs: Follow tab (the home
// tab open now, by default), All, or one tab (projectOnBar's rule, kept on the
// device), and past 8 projects a search (name, key, path). A project opened from
// a link (`?project=KEY`) opens even when the filter hides it.
import type { PmOverview } from '#shared/pm/project'
import { shownKey } from '#shared/pm/projectKey'
import { EXAMPLES } from '#shared/pm/examples'
import { projectTab, projectsMatching, type ProjectTab } from '~/utils/projectTabs'

const props = defineProps<{ active: boolean }>()
const route = useRoute()
const router = useRouter()
const data = ref<PmOverview | null>(null)
const error = ref('')
const loadError = ref('')
const busy = ref(false)
const workspaceOpen = ref(false)

const machineName = (key: string) => key ? (appConfig.value.machines?.find(m => m.key === key)?.label || key) : (appConfig.value.hostLabel || t('This machine'))

async function load() {
  loadError.value = ''
  try { data.value = await api<PmOverview>('/api/pm/overview') }
  catch (e) { (data.value ? error : loadError).value = (e as Error).message }
}
watch(() => props.active, (on) => { if (on && !data.value) load(); if (on) loadCoordinators() }, { immediate: true })
const proposes = (key: string) => projectCoordinators.value.some(c => c.project === key && c.proposal)
// A project added from the New sheet: the list again.
watch(newAgentOpen, (o) => { if (!o && props.active && data.value) load() })

async function toggle(on: boolean) {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try { data.value = await api<PmOverview>('/api/pm/enabled', { enabled: on }) }
  catch (e) { error.value = (e as Error).message }
  finally { busy.value = false }
}
// The New sheet on its Project form (read by NewAgentSheet when it opens).
function addProject() {
  newProjectOpen.value = true
  newAgentOpen.value = true
}
// Alfred's `ui open --target projects.setup`: Add project's form opens too, not only its button's halo.
// Projects off: the halo is on the switch instead (adding is refused while off), and the
// form opens once it is turned on.
watch(() => props.active && route.query.target === 'projects.setup' && !!data.value?.enabled, (go) => { if (go) addProject() }, { immediate: true })

// The open project and its tab, from the URL.
const opened = computed(() => (props.active ? data.value?.projects.find(p => p.key === route.query.project) : undefined))
const tab = computed(() => projectTab(route.query.tab))
const review = computed(() => route.query.review === '1')
const show = (project?: string, tab?: ProjectTab) => {
  const { project: _p, tab: _t, review: _r, ...query } = route.query
  router.replace({ query: { ...query, ...(project ? { project, tab: tab ?? 'general' } : {}) } })
}
const libraryOpen = computed({
  get: () => props.active && route.query.library === '1',
  set: (o: boolean) => { const { library: _l, ...query } = route.query; router.replace({ query: { ...query, ...(o ? { library: '1' } : {}) } }) },
})
const TAB_FOLLOW = 'follow'
const TAB_ALL = 'all'
const TAB_KEY = 'projectsSettingsTab'
const savedTab = ref<string>((() => { try { return localStorage.getItem(TAB_KEY) || TAB_FOLLOW } catch { return TAB_FOLLOW } })())
watch(savedTab, (v) => { try { localStorage.setItem(TAB_KEY, v) } catch { /* storage unavailable */ } })
// A tab's value: its bar id after `tab:` (the local machine's id is '', which a select item cannot be).
const tabValue = (id: string) => `tab:${id}`
const barTabs = computed(() => machineBarItems.value.filter(x => x.shown && x.id !== BAR_ALL).map(x => x.id))
// A tab removed since it was picked falls back to Follow tab.
const tabPick = computed({
  get: () => (savedTab.value === TAB_ALL || barTabs.value.some(id => tabValue(id) === savedTab.value) ? savedTab.value : TAB_FOLLOW),
  set: (v: string) => { savedTab.value = v },
})
const tabItems = computed(() => [{ label: tl('Follow tab'), value: TAB_FOLLOW }, { label: tl('All'), value: TAB_ALL }, ...barTabs.value.map(id => ({ label: barItemLabel(id), value: tabValue(id) }))])
const onTab = computed(() => (data.value?.projects ?? []).filter(p => tabPick.value === TAB_ALL || (tabPick.value === TAB_FOLLOW ? projectOnBar(p.key) : projectOnBarItem(p.key, tabPick.value.slice(4)))))
const query = ref('')
const searchable = computed(() => onTab.value.length > 8)
const listed = computed(() => (searchable.value ? projectsMatching(onTab.value, query.value) : onTab.value))
const showAll = () => { savedTab.value = TAB_ALL } // the search, if any, then covers every project
const exampleCount = computed(() => EXAMPLES.filter(e => !data.value?.templates.some(t => t.id === e.id)).length)
</script>

<template>
  <div class="settings-group pm-settings" data-testid="pm-settings">
    <label class="settings-toggle">
      <span>
        <b>{{ tl('Project management', 'Gestion de projet') }}</b>
        <small>{{ tl('Tasks follow the workflow of their project. Off, nothing is changed.') }}</small>
      </span>
      <SettingsSkeleton v-if="!data" kind="switch" />
      <USwitch v-else :model-value="data.enabled" :disabled="busy" size="xl" data-testid="pm-switch" :data-ui-target="data.enabled ? undefined : 'projects.setup'" @update:model-value="v => toggle(v)" />
    </label>

    <template v-if="!data">
      <h3>{{ tl('Projects') }}</h3>
      <div v-if="!loadError" class="pm-actions">
        <UButton color="primary" variant="solid" size="xl" icon="i-lucide-plus" disabled data-testid="pm-add">{{ tl('Add project') }}</UButton>
        <UButton color="neutral" variant="outline" size="xl" icon="i-lucide-kanban" disabled data-testid="pm-board">{{ tl('Open the board') }}</UButton>
      </div>
      <SettingsSkeleton :error="loadError" @retry="load" />
    </template>
    <template v-else-if="data.enabled">
      <h3>{{ tl('Projects', 'Projets') }}</h3>
      <div class="pm-actions">
        <UButton color="primary" variant="solid" size="xl" icon="i-lucide-plus" data-testid="pm-add" data-ui-target="projects.setup" @click="addProject">{{ tl('Add project', 'Ajouter le projet') }}</UButton>
        <UButton color="neutral" variant="outline" size="xl" icon="i-lucide-boxes" data-testid="pm-add-workspace" @click="workspaceOpen = true">{{ tl('Add workspace') }}</UButton>
        <UButton v-if="data.projects.length" to="/board" color="neutral" variant="outline" size="xl" icon="i-lucide-kanban" data-testid="pm-board">{{ tl('Open the board', 'Ouvrir le tableau') }}</UButton>
      </div>
      <template v-if="data.projects.length">
        <USelect v-if="barTabs.length" v-model="tabPick" :items="tabItems" size="lg" class="pm-tab" :aria-label="tl('Tab')" data-testid="pm-tab" />
        <NameFilter v-if="searchable" v-model="query" class="pm-search" :label="tl('Search projects')" data-testid="pm-search" />
      </template>
      <div v-if="listed.length" class="settings-card">
        <button v-for="p in listed" :key="p.key" type="button" class="pm-row" data-testid="pm-project" @click="show(p.key)">
          <span class="pm-id"><b>{{ p.name }}<span v-if="p.visibility?.value === 'public'" class="pm-public" data-testid="pm-public">{{ tl('Public', 'Public') }}</span></b><small class="mono-label">{{ shownKey(p) }} · {{ machineName(p.machine) }}</small><small v-if="proposes(p.key)" class="mono-label pm-review" data-testid="pm-review"><span class="card-state blocked" aria-hidden="true"><i /></span>{{ tl('1 to review') }}</small><small class="pm-path">{{ ltr(shortPath(p.path)) }}</small></span>
          <UIcon name="i-lucide-chevron-right" class="pm-chevron" />
        </button>
      </div>
      <p v-else-if="data.projects.length" class="muted settings-hint" data-testid="pm-none">{{ searchable && query.trim() ? tl('No project matches.') : tl('No project on this tab.') }} <UButton v-if="tabPick !== TAB_ALL" variant="link" color="primary" class="pm-show-all" data-testid="pm-show-all" @click="showAll">{{ tl('Show all tabs') }}</UButton></p>
      <p v-else class="muted settings-hint" data-testid="pm-empty">{{ tl('No project yet.', 'Aucun projet pour l’instant.') }}</p>
      <button type="button" class="settings-card pm-row pm-library" data-testid="pm-library" @click="libraryOpen = true">
        <span class="pm-id"><b>{{ tl('Template library') }}</b><small class="mono-label">{{ tl(`${data.templates.length} saved · ${exampleCount} examples`) }}</small></span>
        <UIcon name="i-lucide-chevron-right" class="pm-chevron" />
      </button>
      <WorkspaceAddSheet v-model:open="workspaceOpen" :taken="data.projects.flatMap(p => [p.key, ...(p.aliases ?? [])])" @added="k => { load(); show(k) }" />
      <TemplateLibrary v-model:open="libraryOpen" :templates="data.templates" @changed="load" />
      <ProjectSheet v-if="opened" :key="opened.key" :project="opened" :tab="tab" :templates="data.templates" :projects="data.projects" :review="review" @tab="k => show(opened!.key, k)" @close="show()" @changed="load" />
    </template>
    <p v-if="error" class="form-error" role="alert">{{ t(error) }}</p>
  </div>
</template>

<style scoped>
.pm-settings h3 { margin-top: 24px; }
.pm-settings .settings-card { padding: 0; }
.pm-row { display: flex; width: 100%; align-items: center; gap: 12px; padding: 13px 16px; border-bottom: 1px solid var(--line); text-align: left; }
.pm-row:last-child { border-bottom: 0; }
.pm-row:active { background: var(--surface-2); }
.pm-id { display: grid; flex: 1; gap: 2px; min-width: 0; overflow-wrap: anywhere; }
.pm-path { color: var(--muted); font-family: var(--font-mono, 'JetBrains Mono', monospace); font-size: 12px; }
.pm-review { display: flex; align-items: center; gap: 6px; color: var(--blocked); }
.pm-chevron { flex: none; color: var(--muted); }
.pm-public { margin-left: 8px; padding: 2px 6px; border: 1px solid var(--blocked); color: var(--blocked); font: 600 11px/1 var(--font-mono, 'JetBrains Mono', monospace); letter-spacing: .08em; text-transform: uppercase; vertical-align: 2px; }
.pm-settings .pm-library { margin-top: 16px; padding: 13px 16px; border-bottom: 1px solid var(--line); }
.pm-settings .pm-tab { width: 100%; max-width: 320px; margin-bottom: 8px; }
.pm-search { margin-bottom: 8px; }
.pm-show-all { padding: 0; }
.pm-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; }
</style>
