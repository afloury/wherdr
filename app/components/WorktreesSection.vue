<script setup lang="ts">
// Settings: the agents' Git worktrees, to remove when no longer needed.
import type { WorktreeInfo } from '#shared/types'

onMounted(loadWorktrees)
const machines = computed(() => [...new Set((worktrees.value || []).map(w => w.machine))])
const selected = ref<string | null>(null)
const active = computed(() => selected.value !== null && machines.value.includes(selected.value) ? selected.value : machines.value[0])
const projects = computed(() => {
  const groups = new Map<string, { root: string, name: string, items: WorktreeInfo[] }>()
  for (const w of worktrees.value || []) {
    if (w.machine !== active.value) continue
    if (!groups.has(w.repoRoot)) groups.set(w.repoRoot, { root: w.repoRoot, name: w.repo, items: [] })
    groups.get(w.repoRoot)!.items.push(w)
  }
  return [...groups.values()]
})
const collapsed = ref(new Set<string>())
const projectKey = (root: string) => JSON.stringify([active.value, root])
function toggleProject(root: string) {
  const key = projectKey(root)
  if (collapsed.value.has(key)) collapsed.value.delete(key)
  else collapsed.value.add(key)
}
const uid = useId()
const tabId = (machine: string) => `${uid}-machine-${machines.value.indexOf(machine)}`
function moveTab(event: KeyboardEvent, index: number) {
  const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End']
  if (!keys.includes(event.key)) return
  event.preventDefault()
  const n = machines.value.length
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? n - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + n) % n
  selected.value = machines.value[next]!
  document.getElementById(tabId(selected.value))?.focus()
}
const multi = computed(() => Boolean(herdrState.value.machines && herdrState.value.machines.length > 1))
const machineLabel = (k: string) => (herdrState.value.machines || []).find(m => m.key === k)?.label || k || hostLabel.value
function state(w: WorktreeInfo) {
  if (w.prunable) return t('folder missing')
  if (!w.workspace) return t('closed')
  if (w.agents) return tl(`open · ${w.agents} agent${w.agents > 1 ? 's' : ''}`, `ouvert · ${w.agents} agent${w.agents > 1 ? 's' : ''}`)
  return tl('open', 'ouvert')
}
const busy = ref<string | null>(null)
async function remove(w: WorktreeInfo) {
  busy.value = w.path
  await removeWorktreeFlow(w)
  busy.value = null
}
</script>

<template>
  <div class="settings-group">
    <h3>{{ t('Worktrees') }}</h3>
    <div class="settings-card wt-card">
      <p v-if="worktrees === null" class="muted"><span class="spinner" /></p>
      <p v-else-if="!worktrees.length" class="muted">{{ t('No worktrees.') }}</p>
      <template v-else>
        <div class="wt-machines" role="tablist" :aria-label="t('Worktrees')">
          <button v-for="(machine, index) in machines" :id="tabId(machine)" :key="machine" type="button" role="tab"
            :aria-selected="active === machine" :aria-controls="`${uid}-panel`" :tabindex="active === machine ? 0 : -1"
            @click="selected = machine" @keydown="moveTab($event, index)">{{ machineLabel(machine) }}</button>
        </div>
        <div :id="`${uid}-panel`" role="tabpanel" tabindex="0" :aria-labelledby="tabId(active!)">
          <section v-for="(project, index) in projects" :key="projectKey(project.root)" class="wt-project">
            <button type="button" class="wt-project-heading" :aria-expanded="!collapsed.has(projectKey(project.root))"
              :aria-controls="`${uid}-project-${index}`" @click="toggleProject(project.root)">
              <UIcon :name="collapsed.has(projectKey(project.root)) ? 'i-lucide-chevron-right' : 'i-lucide-chevron-down'" />
              <span>{{ project.name }}</span><span class="wt-count">{{ project.items.length }}</span>
            </button>
            <ul v-show="!collapsed.has(projectKey(project.root))" :id="`${uid}-project-${index}`" class="wt-list">
              <li v-for="w in project.items" :key="`${w.machine}|${w.path}`" :class="{ open: w.workspace, gone: w.prunable }">
                <div class="wt-main">
                  <b><UIcon name="i-lucide-git-branch" />{{ worktreeName(w) }}</b>
                  <span class="wt-meta">{{ w.repo }}<template v-if="multi"> · {{ machineLabel(w.machine) }}</template> · <i>{{ state(w) }}</i></span>
                  <span class="wt-path">{{ shortPath(w.path) }}</span>
                </div>
                <button type="button" class="wt-del" :disabled="busy === w.path" :aria-label="t('Delete')" @click="remove(w)">
                  <span v-if="busy === w.path" class="spinner" /><UIcon v-else name="i-lucide-trash-2" />
                </button>
              </li>
            </ul>
          </section>
        </div>
      </template>
      <p class="muted">{{ t('Deleting a worktree removes its folder; the Git branch is kept.') }}</p>
    </div>
  </div>
</template>
