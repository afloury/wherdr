<script setup lang="ts">
// The board: Your turn first, then the columns of the project's template
// (To do / Working / Done for all projects, with the step on the card). A
// card's indicator is the live state of the agent holding its step.
import { boardLanes, boardTags, canStop, mainLink, type Board, type Card } from '#shared/pm/board'
import { RESUMES } from '#shared/pm/stop'
import type { Pane } from '#shared/types'

const data = ref<Board | null>(null)
const error = ref('')
const project = ref('') // '' = all projects
const tag = ref('') // '' = every tag
// The task to show, also from Decisions' "Open task" (/board?task=CO-1).
const route = useRoute()
const open = ref<string | null>(typeof route.query.task === 'string' ? route.query.task : null)
const decisions = ref(0) // what waits for the user's choice, on the Decisions screen

async function load() {
  try { data.value = await api<Board>('/api/pm/board'); error.value = ''; loadCoordinators(); api<unknown[]>('/api/pm/decisions').then((d) => { decisions.value = d.length }, () => {}) }
  catch (e) { error.value = (e as Error).message }
}
let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => { load(); timer = setInterval(load, 10_000) })
onBeforeUnmount(() => clearInterval(timer))

// An agent asking a question or a permission puts its card in Your turn too.
const waitsForYou = (c: Card) => { const p = paneOf(c); return !!p && hasAgent(c) && statusKey(p) === 'blocked' }
const cards = computed(() => (data.value?.cards ?? [])
  .filter(c => (!project.value || c.project === project.value) && (!tag.value || c.tags.includes(tag.value)))
  .map(c => (!c.yourTurn && waitsForYou(c) ? { ...c, yourTurn: tl('Answer the agent', 'Réponds à l’agent') } : c)))
const projectPick = noneModel(project)
const tagPick = noneModel(tag)
const projectItems = computed(() => [{ label: tl('All projects', 'Tous les projets'), value: NONE }, ...(data.value?.projects ?? []).map(p => ({ label: p.name, value: p.key }))])
const tagItems = computed(() => [{ label: tl('Tags', 'Étiquettes'), value: NONE }, ...tags.value.map(x => ({ label: x, value: x }))])
const tags = computed(() => boardTags((data.value?.cards ?? []).filter(c => !project.value || c.project === project.value)))
// The header's coordinator button: the project's, or Alfred's on All projects.
const coordinator = computed(() => coordinators.value.find(c => (project.value ? c.project === project.value : c.main)))
const columns = computed(() => (project.value ? data.value?.projects.find(p => p.key === project.value)?.columns ?? [] : null))
const lanes = computed(() => boardLanes(cards.value, columns.value))
const PHASE_LABEL: Record<string, string> = { 'your-turn': 'Your turn', 'todo': 'To do', 'working': 'Working', 'done': 'Done' }
const laneLabel = (id: string) => (columns.value && id !== 'your-turn' ? id : t(PHASE_LABEL[id]!))
const showStep = (c: Card, lane: string) => c.step && (!columns.value || lane === 'your-turn')

// The holder's pane, by its herdr-core address; none for holder: none.
const hasAgent = (c: Card) => c.holder !== 'none' && !c.state?.done
const paneOf = (c: Card): Pane | undefined => (c.terminal ? herdrState.value?.panes.find(p => p.coreAddress === c.terminal) : undefined)
const live = (c: Card) => {
  const p = paneOf(c)
  return p ? { key: statusKey(p), label: `${t(c.holder === 'reviewer' ? 'Reviewer' : 'Worker')}: ${statusLabel(p)}` } : { key: 'inactive', label: tl('No agent running', 'Aucun agent lancé') }
}
// The card's menu: Stop (confirmed in the task's sheet), how a stopped task
// goes on, or Delete for a task never started (confirmed).
const stopping = ref(false)
const show = (id: string, stop = false) => { stopping.value = stop; open.value = id }
const act = (fn: () => Promise<unknown>) => fn().then(load, (e: Error) => { error.value = e.message })
const menuOf = (c: Card): MenuItem[] => [
  { label: tl('Open', 'Ouvrir'), icon: 'i-lucide-panel-right-open', run: () => show(c.id) },
  ...(canStop(c) ? [{ label: tl('Stop…', 'Arrêter…'), icon: 'i-lucide-square', danger: true, run: () => show(c.id, true) }] : []),
  ...(c.stopped ? RESUMES.map(how => ({ label: tl(...RESUME_LABEL[how]), danger: how === 'archive', run: () => act(() => resumeTaskApi(c.id, how)) })) : []),
  ...(c.removable ? [{ label: tl('Delete…', 'Supprimer…'), icon: 'i-lucide-trash-2', danger: true, run: () => act(() => removeTaskApi(c.id)) }] : []),
]
const selected = computed(() => cards.value.find(c => c.id === open.value) ?? data.value?.cards.find(c => c.id === open.value) ?? null)
</script>

<template>
  <section id="board" data-wherdr="board" class="view board" data-testid="board">
    <header class="board-top">
      <UButton icon="i-lucide-chevron-left" color="neutral" variant="ghost" size="lg" class="icon-btn back" :aria-label="t('Back')" to="/" />
      <h1 class="display">{{ tl('Board', 'Tableau') }}</h1>
      <UButton :color="decisions ? 'warning' : 'neutral'" :variant="decisions ? 'solid' : 'outline'" size="lg" to="/decisions" data-testid="board-decisions">
        {{ tl('Decisions', 'Décisions') }}<span v-if="decisions" class="mono-label board-decisions-n">{{ decisions }}</span>
      </UButton>
      <USelect v-model="projectPick" :items="projectItems" size="lg" class="board-select" :aria-label="tl('Project', 'Projet')" data-testid="board-project" />
      <USelect v-if="tags.length || tag" v-model="tagPick" :items="tagItems" size="lg" class="board-select" :aria-label="tl('Tag', 'Étiquette')" data-testid="board-tag" />
      <CoordinatorButton v-if="coordinator" :c="coordinator" open />
    </header>
    <!-- One scroll on the phone, so a tall guide does not hide the lanes. -->
    <div class="board-body">
    <PmGuide :always="route.query.guide === '1'" />
    <p v-if="error" class="error board-note">{{ error }}</p>
    <p v-else-if="data && !data.cards.length" class="muted board-note">{{ tl('No task yet.', 'Aucune tâche pour l’instant.') }}</p>
    <div class="board-lanes">
      <section v-for="l in lanes" :key="l.id" class="board-lane" :class="{ mine: l.id === 'your-turn' }" :data-lane="l.id" data-testid="board-lane">
        <h2 class="mono-label">{{ laneLabel(l.id) }} <span>{{ l.cards.length }}</span></h2>
        <div v-for="c in l.cards" :key="c.id" class="board-card-wrap">
        <button type="button" class="board-card" data-testid="board-card" :data-task="c.id" @click="show(c.id)">
          <span class="board-card-head">
            <span v-if="hasAgent(c)" class="card-state" :class="live(c).key" role="img" :aria-label="live(c).label" :title="live(c).label" data-testid="holder-state"><i /></span>
            <b>{{ c.title }}</b>
          </span>
          <small class="mono-label">{{ c.id }}<template v-if="showStep(c, l.id)"> · {{ c.step }}</template></small>
          <span v-if="c.yourTurn" class="board-badge" data-testid="board-badge">{{ c.yourTurn }}</span>
          <span v-if="c.tags.length || c.links.length" class="board-tags">
            <span v-for="tag in c.tags.slice(0, 2)" :key="tag" class="board-chip">{{ tag }}</span>
            <span v-if="c.tags.length > 2" class="board-chip">+{{ c.tags.length - 2 }}</span>
            <a v-if="mainLink(c)" :href="mainLink(c)!.url" target="_blank" rel="noopener" class="board-chip" data-testid="board-link" @click.stop>{{ mainLink(c)!.label }}</a>
          </span>
        </button>
        <UDropdownMenu v-if="!sheetMenus" :items="toDropdown(menuOf(c))" :content="{ align: 'end', sideOffset: 4 }" :ui="{ content: 'hw-dropdown' }">
          <UButton icon="i-lucide-ellipsis" color="neutral" variant="ghost" size="lg" class="icon-btn board-card-menu" :aria-label="tl('Task menu', 'Menu de la tâche')" data-testid="card-menu" />
        </UDropdownMenu>
        <UButton v-else icon="i-lucide-ellipsis" color="neutral" variant="ghost" size="lg" class="icon-btn board-card-menu" :aria-label="tl('Task menu', 'Menu de la tâche')" data-testid="card-menu" @click="openMenu(menuOf(c), c.title)" />
        </div>
      </section>
    </div>
    </div>
    <TaskSheet v-if="selected" :key="`${selected.id}:${stopping}`" :card="selected" :pane="paneOf(selected)" :stopping="stopping" @closed="open = null; stopping = false" @changed="load" />
  </section>
</template>

<style scoped>
.board { color: var(--text); }
.board-top { flex: none; display: flex; align-items: center; gap: 8px; min-height: calc(44px + var(--safe-top, 0px)); padding: var(--safe-top, 0px) 8px 0; border-bottom: 1px solid var(--line); }
.board-top h1 { flex: 1; margin: 0; font-size: 20px; }
.board-decisions-n { margin-left: 6px; color: inherit; }
.board-top :deep(.board-select) { min-width: 0; flex: 0 1 auto; }
.board-note { padding: 12px 16px; }
.board-body { flex: 1; min-height: 0; display: flex; flex-direction: column; overflow-y: auto; overscroll-behavior: contain; }
.board-lanes { flex: 1 0 auto; min-height: 0; display: flex; flex-direction: column; overflow-y: auto; overscroll-behavior: contain; padding-bottom: var(--safe-bottom, 0px); }
.board-lane { flex: none; border-bottom: 1px solid var(--line); padding: 12px 16px; display: flex; flex-direction: column; gap: 8px; }
.board-lane h2 { margin: 0; display: flex; justify-content: space-between; color: var(--muted); }
.board-lane.mine h2 { color: var(--blocked); }
.board-card-wrap { position: relative; display: flex; flex-direction: column; }
.board-card-menu { position: absolute; top: 0; right: 0; }
.board-card-wrap .board-card-head { padding-right: 36px; }
.board-card { display: flex; flex-direction: column; gap: 4px; text-align: left; padding: 10px 12px; min-height: 44px; border: 1px solid var(--line); background: var(--surface); color: var(--text); }
.board-card:active { background: var(--surface-2); }
.board-card-head { display: flex; align-items: center; gap: 8px; }
@media (min-width: 900px) {
  .board-body { overflow-y: hidden; }
  .board-lanes { flex: 1; flex-direction: row; align-items: stretch; overflow-x: auto; }
  .board-lane { flex: 1 0 220px; max-width: 360px; border-bottom: 0; border-right: 1px solid var(--line); }
}
</style>
