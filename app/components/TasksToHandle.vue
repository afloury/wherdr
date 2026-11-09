<script setup lang="ts">
// Tasks to handle: the tasks waiting for the user (the board's Your turn,
// GET /api/pm/handle), between the coordinators and the agent sessions;
// hidden when there is none. Rows are tasks, not agents: the task's id,
// title, what to do and a short action. A tap goes where the user acts: an
// agent that asks (a question, a permission) opens its conversation, on any
// machine; anything else opens the task's sheet on the board, on its To do
// tab. The sheet stays one tap away (the row's small icon).
import type { ToHandle } from '#shared/pm/board'

const tasks = ref<ToHandle[]>([])
const load = () => api<ToHandle[]>('/api/pm/handle').then((v) => { tasks.value = Array.isArray(v) ? v : [] }, () => {})
let timer: ReturnType<typeof setInterval> | undefined
// Read while the list is on screen: a hidden page waits for the next tick it is shown.
onMounted(() => { load(); timer = setInterval(() => { if (!document.hidden) load() }, 15_000) })
onBeforeUnmount(() => clearInterval(timer))
const sheet = (id: string) => navigateTo({ path: '/board', query: { task: id } })
// The asking agent's pane, when it is on screen here.
const agentOf = (x: ToHandle) => (x.terminal ? herdrState.value?.panes.find(p => p.coreAddress === x.terminal) : undefined)
const open = (x: ToHandle) => { const p = agentOf(x); return p ? navigateTo(panePath(p.id)) : sheet(x.id) }
</script>

<template>
  <section v-if="tasks.length" class="agent-group handle-list" data-testid="tasks-to-handle">
    <h2 class="group-title"><span>{{ tl('Tasks to handle', 'Tâches à traiter') }}</span><span class="count">{{ tasks.length }}</span></h2>
    <div v-for="x in tasks" :key="x.id" class="handle-item" :data-task="x.id">
      <button type="button" class="handle-row" :title="x.action" :data-opens="agentOf(x) ? 'agent' : 'task'" @click="open(x)">
        <span class="handle-head">
          <ProjectBadge :text="x.shown" :color="x.color" />
          <b class="handle-title">{{ x.title }}</b>
          <small class="handle-label mono-label">{{ t(x.label) }}</small>
        </span>
        <small class="handle-action">{{ x.action }}</small>
      </button>
      <UButton v-if="agentOf(x)" icon="i-lucide-list-todo" color="neutral" variant="ghost" size="lg" class="icon-btn handle-sheet" :aria-label="tl('Open the task')" :title="tl('Open the task')" data-testid="handle-sheet" @click="sheet(x.id)" />
    </div>
  </section>
</template>

<style scoped>
.handle-list { display: grid; }
.handle-list .group-title { color: var(--blocked); }
.handle-list .group-title::before { background: var(--blocked); }
.handle-item { display: flex; align-items: stretch; min-width: 0; border: 1px solid var(--line); border-top-width: 0; background: var(--surface); }
.handle-item:first-of-type { border-top-width: 1px; }
.handle-row { flex: 1; min-width: 0; display: grid; gap: 2px; min-height: 48px; padding: 8px 12px; border: 0; background: none; color: var(--text); text-align: left; cursor: pointer; }
.handle-row:hover, .handle-sheet:hover { background: var(--surface-2); }
.handle-sheet { flex: none; align-self: center; margin-right: 2px; }
.handle-row:focus-visible { outline: 1px solid var(--mauve); outline-offset: -1px; }
.handle-head { display: flex; align-items: center; gap: 8px; min-width: 0; }
.handle-title { flex: 1; min-width: 0; overflow: hidden; font: 600 14px/1.3 var(--display); text-overflow: ellipsis; white-space: nowrap; }
.handle-label { flex: none; color: var(--blocked); font-size: 11px; }
.handle-action { overflow: hidden; color: var(--muted); font: 12px/1.4 var(--mono); text-overflow: ellipsis; white-space: nowrap; }
</style>
