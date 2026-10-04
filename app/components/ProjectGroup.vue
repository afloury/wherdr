<script setup lang="ts">
// herdr-projects project in the list: collapsible header (name, number
// of agents, summarized state), then the coordinator and its threads (a space
// card when the thread has several tabs or panes, `rowOf`).
// Coordinator on another machine (`remote`): the threads stay under
// their own, the header says where the project is coordinated from and links there.
// Root terminal of the threads' repository (`roots`): small "Repository <name> ·
// N worktrees" header above them: a click collapses it, its menu (right click on
// a computer, long press on the phone) opens that terminal.
import type { Pane } from '#shared/types'
import type { ProjectGroup } from '#shared/projects'
import type { RepoRoot, Row } from '#shared/spaces'
import { projectCounts, projectSections, threadNumber } from '#shared/projects'
import type { MenuItem } from '~/composables/useUi'
import { repoHeaderState, threadCountLabel } from '~/utils/terminalVisibility'
import { longPress } from '~/utils/longPress'

const props = defineProps<{ group: ProjectGroup<Pane>, machine?: string, rowOf?: (p: Pane) => Row | undefined, remote?: Pane | null, roots?: RepoRoot[] }>()
const sections = computed(() => projectSections(props.group, props.roots || []))
function openRoot(r: RepoRoot) {
  if (!showShells.value) return
  openSpace(r.row.lead.workspace)
}
// Its terminal is open (computer: view to the right of the list).
const isOpen = (r: RepoRoot) => (r.row.kind === 'space' ? r.row.panes : [r.row.pane]).some(p => p.id === curPane.value)
const headerState = (r?: RepoRoot | null) => repoHeaderState(showShells.value, !!r && isOpen(r), !!r)
function repoItems(r?: RepoRoot | null): MenuItem[] {
  if (!r || !headerState(r).menu) return []
  return [{ label: tl('Open terminal', 'Ouvrir le terminal'), icon: 'i-lucide-square-terminal', run: () => openRoot(r) }]
}
const repoMenuTitle = (name: string) => `${tl('Repo', 'Dépôt')} ${name}`
let pressed: { root?: RepoRoot | null, name: string } | null = null
const lp = longPress({
  onPress: () => {
    const items = repoItems(pressed?.root)
    if (!pressed || !items.length) return
    haptic()
    openMenu(items, repoMenuTitle(pressed.name))
  },
})
// Touch or narrow screen only: otherwise the floating context menu handles it.
function repoDown(e: PointerEvent, root: RepoRoot | null | undefined, name: string) {
  if (!sheetMenus.value) return
  pressed = { root, name }
  lp.down(e)
}
function repoClick(key: string) {
  if (lp.swallowClick()) return
  toggleRepo(key)
}
const worktreeCount = (n: number) => (n === 1 ? tl('1 worktree', '1 worktree') : tl(`${n} worktrees`, `${n} worktrees`))
function openCoordinator() {
  if (!props.remote) return
  haptic()
  navigateTo(panePath(props.remote.id))
}

const id = computed(() => `${props.machine || ''}|${props.group.key}`)
const collapsed = computed(() => collapsedProjects.value.includes(id.value))
const repoId = (key: string) => `${id.value}|${key}`
const repoCollapsed = (key: string) => collapsedRepos.value.includes(repoId(key))
function toggleRepo(key: string) {
  haptic()
  const id = repoId(key)
  const c = collapsedRepos.value
  collapsedRepos.value = c.includes(id) ? c.filter(k => k !== id) : [...c, id]
}
function toggle() {
  haptic()
  const c = collapsedProjects.value
  collapsedProjects.value = c.includes(id.value) ? c.filter(k => k !== id.value) : [...c, id.value]
}
// A coordinator's space counts each of its tabs (a thread opened as a tab).
const sum = computed(() => projectCounts(props.group.panes, props.rowOf))
const ready = computed(() => sum.value.ready)
const projectTitle = computed(() => {
  const p = props.group.coordinator || props.remote
  return p ? spaceTitle(p, herdrState.value.workspaces.find(w => w.id === p.workspace)) : props.group.name
})
const tag = (p: Pane) => {
  if (p === props.group.coordinator) return t('coordinator')
  const n = threadNumber(p)
  return n == null ? null : `t-${String(n).padStart(4, '0')}`
}
</script>

<template>
  <section class="agent-group project" :class="{ collapsed, blocked: sum.blocked > 0 }" :data-project="group.key">
    <button type="button" class="group-title project-head" :aria-expanded="!collapsed" @click="toggle">
      <UIcon name="i-lucide-chevron-down" class="project-chev" />
      <span class="project-name">{{ projectTitle }}</span>
      <span class="count">{{ sum.total }}</span>
      <span class="project-sum">
        <span v-if="sum.blocked" class="blocked"><i />{{ sum.blocked }}<span class="project-sum-l">{{ t('your turn') }}</span></span>
        <span v-if="sum.working" class="working"><i />{{ sum.working }}<span class="project-sum-l">{{ t('working') }}</span></span>
        <span v-if="ready && (collapsed || !sum.blocked && !sum.working)" class="ready"><i />{{ ready }}<span class="project-sum-l">{{ t('ready') }}</span></span>
      </span>
    </button>
    <button v-if="remote" type="button" class="project-remote" @click="openCoordinator">
      <UIcon name="i-lucide-radio-tower" class="project-remote-icon" />
      <span>{{ tl('Coordinated from', 'Coordonné depuis') }} <b>{{ machineName(remote.machine) }}</b></span>
      <span class="project-remote-go">{{ t('coordinator') }}<UIcon name="i-lucide-arrow-up-right" /></span>
    </button>
    <template v-if="!collapsed">
      <div v-if="sections.coordinator" class="card-list project-coordinator">
        <AgentCard :pane="sections.coordinator" :tag="tag(sections.coordinator)" :row="rowOf?.(sections.coordinator)" />
      </div>
      <div v-for="repo in sections.repos" :key="repo.key" class="project-repo-group" :class="{ folded: repoCollapsed(repo.key) }">
        <UContextMenu :disabled="sheetMenus || !repoItems(repo.root).length" :items="sheetMenus ? [] : toDropdown(repoItems(repo.root))" :ui="{ content: 'hw-dropdown' }">
          <button type="button" class="project-repo" :class="{ sel: headerState(repo.root).selected }"
            :aria-expanded="!repoCollapsed(repo.key)"
            :aria-current="headerState(repo.root).selected ? 'page' : undefined"
            :title="repo.root?.row.lead.cwd || undefined"
            @pointerdown="repoDown($event, repo.root, repo.name)" @pointermove="lp.move" @pointerup="lp.cancel" @pointercancel="lp.cancel"
            @contextmenu="sheetMenus && $event.preventDefault()" @click="repoClick(repo.key)">
            <UIcon name="i-lucide-chevron-down" class="project-repo-chev" />
            <UIcon name="i-lucide-git-fork" class="project-repo-icon" />
            <span class="project-repo-l">{{ tl('Repo', 'Dépôt') }}</span>
            <b>{{ repo.name }}</b>
            <span class="project-repo-n">· {{ worktreeCount(repo.worktrees) }}</span>
            <span v-if="repoCollapsed(repo.key)" class="project-repo-summary" :class="repo.blocked ? 'blocked' : repo.working ? 'working' : 'ready'"
              :title="threadCountLabel(repo.panes.length)"><i />{{ repo.panes.length }}<span>{{ repo.panes.length === 1 ? 'thread' : 'threads' }}</span></span>
          </button>
        </UContextMenu>
        <div v-if="!repoCollapsed(repo.key)" class="project-repo-threads card-list">
          <div v-for="p in repo.panes" :key="p.id" class="project-thread-item">
            <AgentCard :pane="p" :tag="tag(p)" :row="rowOf?.(p)" />
          </div>
        </div>
      </div>
      <div v-if="sections.others.length" class="card-list project-others">
        <AgentCard v-for="p in sections.others" :key="p.id" :pane="p" :tag="tag(p)" :row="rowOf?.(p)" />
      </div>
    </template>
  </section>
</template>
