<script setup lang="ts">
// A repo's group on the home list, as Herdr's sidebar draws it with
// herdr-projects. Its head row is its project coordinator, named after the
// repo: the wherdr mark on the accent, "Coordinator", its state (no last
// message; its question and one-tap answers when it asks one). Without a
// coordinator here, the repo's own space takes that row, with its initial.
// Under it, the group's bar: the fold button with a summary of the tasks
// ("4 TASKS · 1 YOUR TURN · 1 LIMIT"), the branch, and the "…" menu of the
// repo's space (its terminal, its actions; closing it closes the whole
// worktree group: the confirmation names the tasks it stops). Then its tasks'
// spaces, indented on a rule (id, title, progress, time on it, the board's
// current line), most urgent first; they fold with the group (kept per
// project on the device).
// One row per task: its helpers (reviewer, planner, attempts, each in a tab
// of the task's space) are part of it, the row says the stage ("Under review
// · codex") and opens the helper's tab while it works.
// Coordinator on another machine (`remote`): the tasks stay here, a line
// says where the repo is coordinated from and opens that coordinator.
import type { Row } from '#shared/spaces'
import { type BoardCard, type ProjectSection } from '#shared/boardLinks'
import type { MenuItem } from '~/composables/useUi'
import { longPress } from '~/utils/longPress'
import { summaryParts, taskSummary } from '~/utils/projectSummary'

const props = defineProps<{ group: ProjectSection, machine?: string }>()
const g = computed(() => props.group)

const id = computed(() => `${props.machine || ''}|${g.value.id}`)
const collapsed = computed(() => collapsedRepos.value.includes(id.value))
function toggle() {
  if (barLp.swallowClick()) return
  haptic()
  const c = collapsedRepos.value
  collapsedRepos.value = c.includes(id.value) ? c.filter(k => k !== id.value) : [...c, id.value]
}

const spaceId = computed(() => {
  const r = g.value.space
  return r ? (r.kind === 'space' ? r.workspace.id : r.lead.workspace) : null
})
function openRepo() {
  const r = g.value.space
  if (!r) return
  haptic()
  if (r.kind === 'space') openSpace(r.workspace.id, r.leadTab.tab.id)
  else navigateTo(panePath(r.pane.id))
}
const repoLabel = computed(() => tl(`Open the terminal of ${g.value.repo}`, `Ouvrir le terminal de ${g.value.repo}`))
useNotificationClock()
const notifyTarget = computed(() => projectNotificationTarget(props.machine || '', g.value.repo))
const headItems = (): MenuItem[] => [notificationMenuItem(notifyTarget.value), ...(spaceId.value
  ? [{ label: repoLabel.value, icon: 'i-lucide-square-terminal', run: openRepo }, { kind: 'separator' as const }, ...workspaceItems(spaceId.value, true)]
  : [])]
// Touch: a long press on the bar opens the same menu as "…".
const barLp = longPress({
  onPress: () => {
    const items = headItems()
    if (!items.length) return
    haptic()
    openMenu(items, g.value.repo)
  },
})

// The tasks only: the coordinator has its own row and state above.
const parts = computed(() => summaryParts(taskSummary(g.value.members), tl))
const foldLabel = computed(() => (collapsed.value
  ? tl(`Show the tasks of ${g.value.repo}`, `Afficher les tâches de ${g.value.repo}`)
  : tl(`Hide the tasks of ${g.value.repo}`, `Masquer les tâches de ${g.value.repo}`)))

const headTitle = computed(() => `${foldLabel.value}: ${parts.value.map(p => p.text).join(' · ')}`)

const behind = computed(() => g.value.info?.behind || 0)
const branchTitle = computed(() => {
  const i = g.value.info
  if (!i?.branch) return undefined
  return behind.value ? tl(`${i.branch}: ${behind.value} commits behind its upstream`, `${i.branch} : ${behind.value} commits de retard sur sa branche distante`) : i.branch
})

// The head row: the coordinator, else the repo's own space, named after the repo.
const leadRow = computed(() => g.value.coordinator || g.value.space)
const leadCard = computed<BoardCard>(() => ({ tag: '', name: g.value.repo, coordinator: Boolean(g.value.coordinator), lead: true }))
const leadLabel = computed(() => (g.value.coordinator ? coordinatorLabel({ kind: 'project', repo: g.value.repo }, '') : g.value.repo))
const initial = computed(() => (g.value.repo.trim()[0] || '?').toUpperCase())

function openRemote() {
  if (!g.value.remote) return
  haptic()
  navigateTo(panePath(g.value.remote.pane))
}
const rowKey = (r: Row) => r.key
</script>

<template>
  <section class="agent-group project" :class="[group.state, { collapsed }]" :data-repo="group.repo">
    <div class="card-list project-lead" role="group" :aria-label="leadLabel">
      <AgentCard v-if="leadRow" :key="leadRow.key" :pane="leadRow.lead" :row="leadRow" :board="leadCard" />
      <!-- Neither a coordinator nor the repo's space here: the same row, nothing to open. -->
      <div v-else class="card compact home-lead">
        <span class="avatar lead-mark" aria-hidden="true">{{ initial }}</span>
        <span class="card-title lead-name">{{ group.repo }}</span>
      </div>
    </div>
    <div class="project-bar">
      <UContextMenu :disabled="sheetMenus" :items="sheetMenus ? [] : toDropdown(headItems())" :ui="{ content: 'hw-dropdown' }">
        <button
          type="button" class="project-head" :aria-expanded="!collapsed" :title="headTitle"
          @pointerdown="sheetMenus && barLp.down($event)" @pointermove="barLp.move" @pointerup="barLp.cancel" @pointercancel="barLp.cancel"
          @contextmenu="sheetMenus && $event.preventDefault()" @click="toggle"
        >
          <UIcon name="i-lucide-chevron-down" class="project-chev" />
          <span class="sr-only">{{ foldLabel }}</span>
          <UIcon v-if="notificationsMuted(notifyTarget)" name="i-lucide-bell-off" class="notification-muted" :title="t('Muted')" />
          <span class="project-sum">
            <!-- Keep the summary on one line; the button title retains every count on narrow screens. -->
            <span v-for="(p, i) in parts" :key="p.key" class="project-sum-part"><span :class="`project-sum-${p.key}`">{{ p.text }}</span><span v-if="i < parts.length - 1" class="project-sum-sep" aria-hidden="true">·</span></span>
          </span>
        </button>
      </UContextMenu>
      <span v-if="group.info?.branch" class="project-branch" :title="branchTitle"><UIcon name="i-lucide-git-branch" /><span class="project-branch-name">{{ group.info.branch }}</span><b v-if="behind">↓{{ behind }}</b></span>
      <SpaceMenu :items="headItems" :title="group.repo" size="sm" :label="tl(`Options: ${group.repo}`, `Options : ${group.repo}`)" />
    </div>
    <button v-if="group.remote" type="button" class="project-remote" @click="openRemote">
      <UIcon name="i-lucide-radio-tower" class="project-remote-icon" />
      <span>{{ tl('Coordinated from', 'Coordonné depuis') }} <b>{{ machineName(group.remote.machine) }}</b></span>
      <span class="project-remote-go">{{ t('coordinator') }}<UIcon name="i-lucide-arrow-up-right" /></span>
    </button>
    <div v-if="!collapsed && group.members.length" class="card-list project-tree">
      <AgentCard v-for="m in group.members" :key="rowKey(m.row)" :pane="m.row.lead" :row="m.row" :board="memberCard(m)" />
    </div>
  </section>
</template>
