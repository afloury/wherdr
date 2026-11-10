<script setup lang="ts">
// Set up project management, one step per screen: turn it on, a project, its
// workflow copied from an example, its guards, its coordinator (and autopilot),
// a first task. Each step does the thing here; it opens at the first step left
// (setupResume) for `project`, or the project setupProject picks; with
// `adding` (Settings › Projects › Add project), at step 2 on a new project
// (SetupProject). The first screen can hand the setup to Alfred instead.
import type { PmOverview } from '#shared/pm/project'
import type { RepoVisibility } from '#shared/pm/visibility'
import type { Template } from '#shared/pm/workflow'
import { EXAMPLES } from '#shared/pm/examples'
import { needsRemote, type FolderProbe } from '#shared/pm/newProject'
import { isCoordinatorProgram } from '#shared/pm/coordinator'
import { SETUP_STEPS, coordinatorStart, setupDone, setupProject, setupResume, workflowLine, type SetupStepId } from '#shared/pm/setup'

const open = defineModel<boolean>('open', { default: false })
const props = defineProps<{ project?: string, adding?: boolean }>()
const emit = defineEmits<{ changed: [] }>()

const data = ref<PmOverview | null>(null)
const key = ref<string>()
const fresh = ref(false) // a new project is being added: none picked by default
const workflow = ref<Template | null>(null)
const index = ref(0)
const busy = ref(false)
const error = ref('')

const done = computed(() => setupDone(data.value, key.value, coordinators.value, started.value))
const step = computed<SetupStepId | undefined>(() => SETUP_STEPS[index.value])
const p = computed(() => data.value?.projects.find(x => x.key === key.value))
const coord = computed(() => coordinators.value.find(c => c.project === key.value))
const pane = computed(() => (coord.value ? coordinatorPane(coord.value) : undefined))
const started = computed(() => coordinatorStart(pane.value))

async function load() {
  const [o] = await Promise.all([api<PmOverview>('/api/pm/overview'), loadCoordinators()])
  data.value = o
  // The one picked here, else the one asked, else the first with a step left.
  key.value = [key.value, props.project].find(k => k && o.projects.some(x => x.key === k)) ?? (fresh.value ? undefined : setupProject(o, coordinators.value))
  workflow.value = p.value?.from ? (await api<{ workflow: Template | null }>(`/api/pm/project?key=${encodeURIComponent(key.value!)}`)).workflow : null
}
async function run(fn: () => Promise<unknown>) {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try { await fn(); await load(); emit('changed') }
  catch (e) { error.value = (e as Error).message }
  finally { busy.value = false }
}
watch(open, (o) => {
  if (!o) return
  data.value = null
  key.value = undefined
  fresh.value = !!props.adding
  error.value = ''
  load().then(() => { index.value = fresh.value ? Number(done.value.enable) : setupResume(done.value) }, (e) => { error.value = (e as Error).message })
}, { immediate: true })

// 2. A project: added here (SetupProject), then its repository's visibility, which the user may correct.
function addProject() { fresh.value = true; key.value = undefined }
function added(k: string) { fresh.value = false; key.value = k; run(async () => {}) }
const VISIBILITY = [{ label: 'Repository: not checked', value: 'unknown', disabled: true }, { label: 'Public repository', value: 'public' }, { label: 'Private repository', value: 'private' }]
const visibilityItems = computed(() => VISIBILITY.map(v => ({ ...v, label: tl(v.label) })))
const setVisibility = (value: string) => run(() => api('/api/pm/project-visibility', { key: key.value, value }))
const visibility = (v?: RepoVisibility) => v?.value ?? 'unknown'
const projectItems = computed(() => (data.value?.projects ?? []).filter(x => x.git !== false).map(x => ({ label: x.name, value: x.key })))
watch(key, (k, old) => { if (old && k) run(async () => {}) })

// 3. Its workflow: a copy of an example.
const example = ref(EXAMPLES[0]!.id)
const applyExample = () => run(() => api('/api/pm/project-apply', { key: key.value, template: `example:${example.value}` }))
// A repository without origin (a git init folder): an example that pushes or
// opens pull requests cannot finish a task there; vibe lands locally.
const remote = ref<boolean>()
watch(() => step.value === 'workflow' && p.value, async (x) => {
  remote.value = undefined
  if (!x) return
  try { remote.value = (await api<FolderProbe>(`/api/pm/folder?machine=${encodeURIComponent(x.machine)}&path=${encodeURIComponent(x.path)}`)).remote }
  catch {}
})
const needsOrigin = computed(() => remote.value === false && needsRemote(EXAMPLES.find(e => e.id === example.value)!))

// 5. Its coordinator, started here; its autopilot, optional, under it.
const agents = computed(() => offerCoordinators(undefined, key.value))
const agent = ref('')
watch(agents, a => { if (!a.some(x => x === agent.value)) agent.value = a[0] ?? '' }, { immediate: true })
const startCoordinator = () => run(async () => { if (isCoordinatorProgram(agent.value)) await launchCoordinator(key.value!, { program: agent.value }) })
// It waits on a question (a login, a dialog): its conversation, to answer it.
function openPane() {
  if (!pane.value) return
  open.value = false
  navigateTo(panePath(pane.value.id))
}

// 6. A first task, of one of its types.
const task = reactive({ title: '', type: '' })
const types = computed(() => Object.keys(workflow.value?.taskTypes ?? {}))
watch(types, t => { if (!t.includes(task.type)) task.type = t[0] ?? '' }, { immediate: true })
const addTask = () => run(async () => {
  await api('/api/pm/task', { project: key.value, title: task.title.trim(), type: task.type, description: '' })
  task.title = ''
})

// Instead: Alfred's conversation, with the setup asked of it.
const toAlfred = () => run(async () => {
  await askAlfred(ALFRED_SETUP_PROMPT)
  open.value = false
})

const TITLE: Record<SetupStepId, string> = {
  enable: 'Turn on project management',
  project: 'Add a project',
  workflow: 'Choose its workflow',
  guards: 'Check its guards',
  coordinator: 'Start its coordinator',
  task: 'Add a first task',
}
const BODY: Record<SetupStepId, string> = {
  enable: 'Tasks then follow the workflow of their project. Off, nothing is changed.',
  project: 'A git repository on one of your machines: each task gets its own worktree. Pushes and pull requests need a remote (origin). wherdr checks whether it is public.',
  workflow: 'The steps a task goes through, and who does each one. The project gets its own copy, to change later in its Workflow tab.',
  guards: 'The branches no agent merges into on its own, and who merges. The workflow’s defaults are shown; Next keeps them.',
  coordinator: 'The agent you talk to about the project: it adds tasks and follows them on the board.',
  task: 'It shows on the board, ready to start.',
}
</script>

<template>
  <AppSheet v-model:open="open" :title="tl('Set up projects')" wide hide-close>
    <div class="setup" data-testid="setup-wizard" :data-step="step ?? 'done'">
      <div class="setup-progress" role="progressbar" :aria-valuenow="index" aria-valuemin="0" :aria-valuemax="SETUP_STEPS.length" :aria-label="tl('Setup progress')">
        <i v-for="(s, i) in SETUP_STEPS" :key="s" :class="{ done: done[s], here: i === index }" />
      </div>
      <template v-if="step">
        <p class="mono-label" data-testid="setup-count">{{ tl(`Step ${index + 1} of ${SETUP_STEPS.length}`) }}</p>
        <h2 class="display">{{ tl(TITLE[step]) }}</h2>
        <p class="muted">{{ tl(BODY[step]) }}</p>
      </template>
      <p v-if="!data && !error" class="muted">{{ tl('Loading…') }}</p>

      <template v-else-if="step === 'enable'">
        <UButton v-if="!done.enable" size="xl" color="primary" class="hw-cta" icon="i-lucide-power" :loading="busy" data-testid="setup-enable" @click="run(() => api('/api/pm/enabled', { enabled: true }))">{{ tl('Turn on') }}</UButton>
        <p v-else class="setup-ok" data-testid="setup-ok">{{ tl('Project management is on.') }}</p>
        <UButton size="xl" color="neutral" variant="outline" icon="i-lucide-message-circle" :loading="busy" data-testid="setup-alfred" @click="toAlfred">{{ tl('Let Alfred guide me') }}</UButton>
      </template>

      <template v-else-if="step === 'project'">
        <SetupProject v-if="!p" :projects="data?.projects ?? []" @added="added" />
        <template v-else>
          <USelect v-if="projectItems.length > 1" v-model="key" :items="projectItems" size="xl" class="w-full" :aria-label="tl('Project')" data-testid="setup-project" />
          <p class="setup-ok" data-testid="setup-ok">{{ p.name }} <span class="mono-label">{{ p.key }}</span></p>
          <USelect :model-value="visibility(p.visibility)" :items="visibilityItems" size="xl" class="w-full" :disabled="busy" :aria-label="tl('Repository')" data-testid="setup-visibility" @update:model-value="v => setVisibility(String(v))" />
          <small class="muted">{{ tl('Public: its coordinator and tasks keep private paths, names and secrets out of it.') }}</small>
          <UButton size="xl" color="neutral" variant="outline" icon="i-lucide-plus" data-testid="setup-another" @click="addProject">{{ tl('Add another project') }}</UButton>
        </template>
      </template>

      <template v-else-if="step === 'workflow'">
        <p v-if="p?.from" class="setup-ok" data-testid="setup-ok">{{ tl(`Copied from ${p.from.template}.`) }}</p>
        <template v-else>
          <div class="setup-choices" role="radiogroup" :aria-label="tl('Workflow')">
            <button v-for="e in EXAMPLES" :key="e.id" type="button" role="radio" :aria-checked="example === e.id" :class="{ on: example === e.id }" :data-example="e.id" @click="example = e.id">
              <b>{{ e.id }}</b><small class="mono">{{ workflowLine(e) }}</small>
            </button>
          </div>
          <p v-if="needsOrigin" class="setup-warn" data-testid="setup-no-remote">
            {{ tl(`This repository has no remote (origin): ${example} pushes or opens pull requests, so its tasks cannot finish. Add one with`) }}
            <code>git remote add origin &lt;url&gt;</code>{{ tl(', or use vibe, which merges into a local branch.') }}
            <UButton size="md" color="neutral" variant="outline" data-testid="setup-use-vibe" @click="example = 'vibe'">{{ tl('Use vibe') }}</UButton>
          </p>
          <UButton size="xl" color="primary" class="hw-cta" icon="i-lucide-copy" :loading="busy" data-testid="setup-apply" @click="applyExample">{{ tl(`Use ${example}`) }}</UButton>
        </template>
      </template>

      <ProjectGuards v-else-if="step === 'guards' && p && workflow" :project="p" :workflow="workflow" @changed="run(async () => {})" />

      <template v-else-if="step === 'coordinator'">
        <template v-if="started === 'none'">
          <AgentPicker v-if="agents.length" v-model="agent" :programs="agents" />
          <p v-else class="muted" data-testid="setup-no-agent">{{ tl('No offered agent can coordinate: check Settings › Agents.') }}</p>
          <UButton size="xl" color="primary" class="hw-cta" icon="i-lucide-play" :loading="busy" :disabled="!agent" data-testid="setup-start" @click="startCoordinator">{{ agent ? tl(`Start with ${kindLabel(agent)}`) : tl('Start') }}</UButton>
        </template>
        <p v-else-if="started === 'starting'" class="muted" data-testid="setup-starting">{{ tl('Its coordinator is starting…') }}</p>
        <template v-else-if="started === 'asks'">
          <p class="setup-ok" data-testid="setup-asks">{{ tl('Its coordinator asks a question before it starts: answer it in its conversation.') }}</p>
          <UButton size="xl" color="primary" class="hw-cta" icon="i-lucide-message-circle" data-testid="setup-open" @click="openPane">{{ tl('Answer its question') }}</UButton>
        </template>
        <template v-else-if="coord">
          <p class="setup-ok" data-testid="setup-ok">{{ tl('Its coordinator runs.') }}</p>
          <details class="setup-autopilot">
            <summary class="mono-label">{{ tl('Autopilot (optional)') }}</summary>
            <CoordinatorAutopilot :c="coord" />
          </details>
        </template>
      </template>

      <template v-else-if="step === 'task'">
        <p v-if="done.task" class="setup-ok" data-testid="setup-ok">{{ tl('Its first task is on the board.') }}</p>
        <form v-else class="sheet-form" @submit.prevent="addTask">
          <UInput v-model="task.title" size="xl" class="w-full" maxlength="200" :placeholder="tl('Title')" :aria-label="tl('Title')" data-testid="setup-task-title" />
          <USelect v-if="types.length > 1" v-model="task.type" :items="types" size="xl" class="w-full" :aria-label="tl('Type')" />
          <UButton type="submit" size="xl" color="primary" class="hw-cta" icon="i-lucide-plus" :loading="busy" :disabled="!task.title.trim() || !task.type" data-testid="setup-add-task">{{ tl('Add task') }}</UButton>
        </form>
      </template>

      <template v-else-if="data">
        <h2 class="display">{{ tl('Set up') }}</h2>
        <p class="muted" data-testid="setup-complete">{{ tl('Every step is done. Add another project from Settings › Projects.') }}</p>
      </template>
      <p v-if="error" class="form-error" role="alert">{{ t(error) }}</p>
    </div>
    <template #footer>
      <div class="setup-nav">
        <UButton size="xl" color="neutral" variant="outline" icon="i-lucide-chevron-left" :disabled="index === 0" data-testid="setup-back" @click="index--">{{ tl('Back') }}</UButton>
        <UButton v-if="step" size="xl" color="primary" :disabled="!done[step]" data-testid="setup-next" @click="index++">{{ tl(index === SETUP_STEPS.length - 1 ? 'Finish' : 'Next') }}</UButton>
        <UButton v-else size="xl" color="primary" data-testid="setup-close" @click="open = false">{{ tl('Close') }}</UButton>
      </div>
    </template>
  </AppSheet>
</template>

<style scoped>
.setup { display: grid; gap: 12px; padding-bottom: 12px; }
.setup h2 { margin: 0; font-size: 22px; }
.setup p { margin: 0; }
.setup-progress { display: grid; grid-template-columns: repeat(6, 1fr); gap: 4px; }
.setup-progress i { height: 4px; background: var(--line); }
.setup-progress i.done { background: var(--done); }
.setup-progress i.here { box-shadow: inset 0 -2px 0 var(--accent); }
.setup-ok { color: var(--text-2); }
.setup-warn { display: grid; gap: 8px; justify-items: start; padding: 10px 12px; border-left: 2px solid var(--blocked); color: var(--text-2); }
.setup-choices { display: grid; border: 1px solid var(--line); }
.setup-choices button { display: grid; gap: 2px; min-height: 48px; padding: 10px 12px; text-align: left; color: var(--text-2); position: relative; }
.setup-choices button + button { border-top: 1px solid var(--line); }
.setup-choices button.on { background: var(--surface-2); color: var(--text); }
.setup-choices button.on::before { content: ''; position: absolute; left: -1px; top: -1px; bottom: -1px; width: 2px; background: var(--accent); }
.setup-choices small { color: var(--muted); font-size: 12px; overflow-wrap: anywhere; }
.setup-autopilot summary { min-height: 44px; display: flex; align-items: center; cursor: pointer; }
.setup-nav { display: flex; justify-content: space-between; gap: 8px; }
.setup-nav > * { min-height: 44px; }
</style>
