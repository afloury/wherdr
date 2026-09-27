<script setup lang="ts">
// Projet herdr-projects dans la liste : en-tête repliable (nom, nombre
// d'agents, état résumé), puis le coordinateur et ses threads (une carte de
// space quand le thread a plusieurs onglets ou panes, `rowOf`).
// Coordinateur sur une autre machine (`remote`) : les threads restent sous la
// leur, l'en-tête dit d'où le projet est coordonné et y mène.
// Terminal racine du dépôt des threads (`roots`) : petit en-tête « Dépôt <nom> ·
// N worktrees » au-dessus d'eux, qui ouvre ce terminal.
import type { Pane } from '#shared/types'
import type { ProjectGroup } from '#shared/projects'
import type { RepoRoot, Row } from '#shared/spaces'
import { projectSections, threadNumber } from '#shared/projects'
import { repoHeaderState } from '~/utils/terminalVisibility'

const props = defineProps<{ group: ProjectGroup<Pane>, machine?: string, rowOf?: (p: Pane) => Row | undefined, remote?: Pane | null, roots?: RepoRoot[] }>()
const sections = computed(() => projectSections(props.group, props.roots || []))
function openRoot(r: RepoRoot) {
  if (!showShells.value) return
  openSpace(r.row.lead.workspace)
}
// Son terminal est ouvert (ordinateur : vue à droite de la liste).
const isOpen = (r: RepoRoot) => (r.row.kind === 'space' ? r.row.panes : [r.row.pane]).some(p => p.id === curPane.value)
const headerState = (r: RepoRoot) => repoHeaderState(showShells.value, isOpen(r))
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
const ready = computed(() => props.group.panes.length - props.group.blocked - props.group.working)
const tag = (p: Pane) => {
  if (p === props.group.coordinator) return t('coordinateur')
  const n = threadNumber(p)
  return n == null ? null : `t-${String(n).padStart(4, '0')}`
}
</script>

<template>
  <section class="agent-group project" :class="{ collapsed, blocked: group.blocked > 0 }" :data-project="group.key">
    <button type="button" class="group-title project-head" :aria-expanded="!collapsed" @click="toggle">
      <UIcon name="i-lucide-chevron-down" class="project-chev" />
      <span class="project-name">{{ group.name }}</span>
      <span class="count">{{ group.panes.length }}</span>
      <span class="project-sum">
        <span v-if="group.blocked" class="blocked"><i />{{ group.blocked }}<span class="project-sum-l">{{ t('à toi') }}</span></span>
        <span v-if="group.working" class="working"><i />{{ group.working }}<span class="project-sum-l">{{ t('au travail') }}</span></span>
        <span v-if="ready && (collapsed || !group.blocked && !group.working)" class="ready"><i />{{ ready }}<span class="project-sum-l">{{ t('prêts') }}</span></span>
      </span>
    </button>
    <button v-if="remote" type="button" class="project-remote" @click="openCoordinator">
      <UIcon name="i-lucide-radio-tower" class="project-remote-icon" />
      <span>{{ tl('Coordonné depuis', 'Coordinated from') }} <b>{{ machineName(remote.machine) }}</b></span>
      <span class="project-remote-go">{{ t('coordinateur') }}<UIcon name="i-lucide-arrow-up-right" /></span>
    </button>
    <template v-if="!collapsed">
      <div v-if="sections.coordinator" class="card-list project-coordinator">
        <AgentCard :pane="sections.coordinator" :tag="tag(sections.coordinator)" :row="rowOf?.(sections.coordinator)" />
      </div>
      <div v-for="repo in sections.repos" :key="repo.key" class="project-repo-group" :class="{ folded: repoCollapsed(repo.key) }">
        <div class="project-repo" :class="{ sel: repo.root && headerState(repo.root).selected }">
          <button type="button" class="project-repo-toggle" :aria-expanded="!repoCollapsed(repo.key)"
            :aria-label="tl(`${repoCollapsed(repo.key) ? 'Déplier' : 'Replier'} le dépôt ${repo.name}`, `${repoCollapsed(repo.key) ? 'Expand' : 'Collapse'} repo ${repo.name}`)"
            @click="toggleRepo(repo.key)">
            <UIcon name="i-lucide-chevron-down" />
          </button>
          <component :is="repo.root ? headerState(repo.root).tag : 'div'"
            :type="repo.root && showShells ? 'button' : undefined" class="project-repo-main"
            :class="{ interactive: repo.root && showShells }"
            :aria-current="repo.root && headerState(repo.root).selected ? 'page' : undefined"
            :title="repo.root?.row.lead.cwd || undefined"
            v-on="repo.root && showShells ? { click: () => openRoot(repo.root!) } : {}">
            <UIcon name="i-lucide-git-fork" class="project-repo-icon" />
            <span class="project-repo-l">{{ tl('Dépôt', 'Repo') }}</span>
            <b>{{ repo.name }}</b>
            <span class="project-repo-n">· {{ worktreeCount(repo.worktrees) }}</span>
            <UIcon v-if="repo.root && showShells" name="i-lucide-square-terminal" class="project-repo-go" />
          </component>
          <span v-if="repoCollapsed(repo.key)" class="project-repo-summary" :class="repo.blocked ? 'blocked' : repo.working ? 'working' : 'ready'"
            :title="tl(`${repo.panes.length} threads`, `${repo.panes.length} threads`)"><i />{{ repo.panes.length }}<span>{{ tl('threads', 'threads') }}</span></span>
        </div>
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
