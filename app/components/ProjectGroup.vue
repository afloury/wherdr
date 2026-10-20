<script setup lang="ts">
// A repo's group on the home list, as Herdr's sidebar draws it with
// herdr-projects: the repo's own space heads it (name, branch, how far behind
// its upstream), then its project coordinator as the group's lead (its own
// icon, "Coordinator" since the header names the repo, its state and last
// message, a rule before the tasks), then its tasks' spaces (id, title,
// progress, time on it, the board's current line), most urgent first.
// One row per task: its helpers (reviewer, planner, attempts, each in a tab
// of the task's space) are part of it, the row says the stage ("Under review
// · codex") and opens the helper's tab while it works.
// The header folds the tasks (kept on the device): the coordinator stays in
// view above them; its terminal button opens
// the repo's space, its menu holds that space's actions (closing it closes
// the whole worktree group: the confirmation names the tasks it stops).
// Coordinator on another machine (`remote`): the tasks stay here, a line
// says where the repo is coordinated from and opens that coordinator.
import { type Row, rowGroup } from '#shared/spaces'
import { type BoardCard, type Member, type MemberStage, type ProjectSection, memberStage, memberTag } from '#shared/boardLinks'
import type { MenuItem } from '~/composables/useUi'
import { longPress } from '~/utils/longPress'

const props = defineProps<{ group: ProjectSection, machine?: string }>()
const g = computed(() => props.group)

const id = computed(() => `${props.machine || ''}|${g.value.id}`)
const collapsed = computed(() => collapsedRepos.value.includes(id.value))
function toggle() {
  if (headLp.swallowClick()) return
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
const isOpen = computed(() => {
  const r = g.value.space
  return Boolean(r && (r.kind === 'space' ? r.panes : [r.pane]).some(p => p.id === curPane.value))
})
const repoLabel = computed(() => tl(`Open the terminal of ${g.value.repo}`, `Ouvrir le terminal de ${g.value.repo}`))
const headItems = (): MenuItem[] => (spaceId.value
  ? [{ label: repoLabel.value, icon: 'i-lucide-square-terminal', run: openRepo }, { kind: 'separator' }, ...workspaceItems(spaceId.value)]
  : [])
const headLp = longPress({
  onPress: () => {
    const items = headItems()
    if (!items.length) return
    haptic()
    openMenu(items, g.value.repo)
  },
})

// Folded, the counts say what is folded: the coordinator stays in view.
const sum = computed(() => {
  const s = { ...g.value.sum }
  const c = g.value.coordinator
  if (collapsed.value && c) s[rowGroup(c)]--
  return s
})

const behind = computed(() => g.value.info?.behind || 0)
const branchTitle = computed(() => {
  const i = g.value.info
  if (!i?.branch) return undefined
  return behind.value ? tl(`${i.branch}: ${behind.value} commits behind its upstream`, `${i.branch} : ${behind.value} commits de retard sur sa branche distante`) : i.branch
})

const coordinatorCard = computed<BoardCard>(() => ({ tag: '', name: t('Coordinator'), coordinator: true }))
const coordinatorLabel = computed(() => tl(`${g.value.repo} coordinator`, `Coordinateur ${g.value.repo}`))
function stageLabel(s: MemberStage): string {
  if (s.what === 'attempts') return tl(`${s.n} attempts`, `${s.n} essais`)
  const what = {
    'review': tl('Under review', 'En revue'),
    'plan-review': tl('Plan review', 'Revue du plan'),
    'pick': tl('Comparing attempts', 'Comparaison des essais'),
    'planning': tl('Planning', 'Plan en cours'),
  }[s.what]
  return s.by ? `${what} · ${s.by}` : what
}
function memberCard(m: Member): BoardCard | null {
  if (!m.task) return null
  const task = m.task
  const stage = memberStage(m)
  return {
    tag: memberTag(m, t('review')),
    stage: stage ? stageLabel(stage) : undefined,
    // While a helper works, its tab (the row's pane's) opens, not the one opened last.
    tab: m.focus && m.row.kind === 'space' ? m.row.leadTab.tab.id : undefined,
    name: task.title || undefined,
    progress: task.progress,
    since: task.since,
    msg: task.msg,
    onBoard: () => navigateTo({ path: '/board', query: { machine: m.board || '', task: task.id } }),
  }
}
function openRemote() {
  if (!g.value.remote) return
  haptic()
  navigateTo(panePath(g.value.remote.pane))
}
const rowKey = (r: Row) => r.key
</script>

<template>
  <section class="agent-group project" :class="[group.state, { collapsed }]" :data-repo="group.repo">
    <div class="project-head-row" :class="{ sel: isOpen }">
      <UContextMenu :disabled="sheetMenus || !spaceId" :items="sheetMenus || !spaceId ? [] : toDropdown(headItems())" :ui="{ content: 'hw-dropdown' }">
        <button
          type="button" class="group-title project-head" :aria-expanded="!collapsed"
          @pointerdown="sheetMenus && headLp.down($event)" @pointermove="headLp.move" @pointerup="headLp.cancel" @pointercancel="headLp.cancel"
          @contextmenu="sheetMenus && $event.preventDefault()" @click="toggle"
        >
          <UIcon name="i-lucide-chevron-down" class="project-chev" />
          <UIcon name="i-lucide-git-fork" class="project-icon" />
          <span class="project-name">{{ group.repo }}</span>
          <span v-if="group.info?.branch" class="project-branch" :title="branchTitle">{{ group.info.branch }}<b v-if="behind">↓{{ behind }}</b></span>
          <span class="project-sum">
            <span v-if="sum.blocked" class="blocked"><i />{{ sum.blocked }}<span class="project-sum-l">{{ t('your turn') }}</span></span>
            <span v-if="sum.working" class="working"><i />{{ sum.working }}<span class="project-sum-l">{{ t('working') }}</span></span>
            <span v-if="sum.ready && (collapsed || !sum.blocked && !sum.working)" class="ready"><i />{{ sum.ready }}<span class="project-sum-l">{{ t('ready') }}</span></span>
          </span>
        </button>
      </UContextMenu>
      <UButton v-if="group.space" icon="i-lucide-square-terminal" color="neutral" variant="ghost" size="sm" class="icon-btn project-term" :aria-label="repoLabel" :title="repoLabel" @click="openRepo" />
      <SpaceMenu v-if="spaceId" :items="headItems" :title="group.repo" size="sm" :label="tl(`Options: ${group.repo}`, `Options : ${group.repo}`)" />
    </div>
    <button v-if="group.remote" type="button" class="project-remote" @click="openRemote">
      <UIcon name="i-lucide-radio-tower" class="project-remote-icon" />
      <span>{{ tl('Coordinated from', 'Coordonné depuis') }} <b>{{ machineName(group.remote.machine) }}</b></span>
      <span class="project-remote-go">{{ t('coordinator') }}<UIcon name="i-lucide-arrow-up-right" /></span>
    </button>
    <div v-if="group.coordinator" class="card-list project-lead" :class="{ alone: collapsed || !group.members.length }" role="group" :aria-label="coordinatorLabel">
      <AgentCard :key="group.coordinator.key" class="project-coordinator" :pane="group.coordinator.lead" :row="group.coordinator" :board="coordinatorCard" />
    </div>
    <div v-if="!collapsed && group.members.length" class="card-list project-tree">
      <AgentCard v-for="m in group.members" :key="rowKey(m.row)" :pane="m.row.lead" :row="m.row" :board="memberCard(m)" />
    </div>
  </section>
</template>
