<script lang="ts">
// Tab shown, per pane: kept when leaving the panel and coming back.
const tabByPane = new Map<string, string>()
</script>

<script setup lang="ts">
// "Project" panel of the herdr-projects coordinator, read-only: the
// TASKS.md lists in their order (known names with an icon), the threads
// open in "In progress" (state given by herdr-projects, re-read when an agent
// of the project changes state), the closed threads in "Done" (20 most recent,
// section collapsed, "see all"). Tapping an open thread opens its agent;
// tapping a report shows it.
// "To test": each task has Confirm (message "✓ Testé : …" sent to the
// coordinator), Problem ("↳ Problème : … —") and Question ("↳ Question : … —"),
// the latter two put into its input field (emitted to the agent view).
// "To decide": Question and Answer also prepare a draft.
// "To review": Reviewed sends "✓ Relu : …", Comment prepares "↳ Retour sur
// … —" (the PR link: link badge or URL in the text, set by the coordinator).
// The drafts that start with "↳" are references (shared/reference.ts): the
// task on one line, the answer below it.
// The only task decorations: the coordinator's [b:color(text)](target)
// badges; URLs in the text are plain links.
// "Backlog": Launch sends the message; Detail prepares a draft.
// "To do" / "In queue": Move up / Move down, Queue it, Launch now, Back to
// backlog / Remove from queue are sent as is; the coordinator edits TASKS.md.
// The "In queue" header shows the thread slots in use (PROJECT.md) and the
// global limit of the coordinator's machine, all projects.
// "In progress": Add info, on an open thread's card and on the task of a
// thread, opens a text sheet; "↳ Info pour t-NNNN : …" is sent to the coordinator,
// which passes the text on to the thread.
// The file is never written from here.
// Tabs: "Tasks" (all of the above), "Threads" (ProjectThreads.vue: every
// thread, its record and its actions), "Inbox" (ProjectInbox.vue: unhandled
// items, Done), "Routines", "Settings" and "Memory" (ProjectRoutines.vue,
// ProjectSettings.vue, ProjectMemory.vue: read-only). A new tab is one more
// entry in TABS and one more block under the tab bar. The bar scrolls sideways
// when the tabs do not fit (a phone); a fade on its edge says there are more.
// `side`: column to the right of the conversation (computer), collapsible.
import type { QueuedMessage } from '#shared/types'
import { type BoardSection, type ListKind, type ProjectBoard, type ProjectTask, type ProjectThread, boardSections, visibleSections, decisionPrefix, detailPrefix, infoMessage, launchMessage, missingLists, moveMessage, type MoveAction, problemPrefix, queueStatus, questionPrefix, reviewCommentPrefix, reviewedMessage, testedMessage, unblockMessage } from '#shared/projectBoard'
import type { BoardAction } from '#shared/globalBoard'
import { machineSlotsLine } from '#shared/threadLimits'

const props = defineProps<{ paneId: string, board: ProjectBoard | null, loading: boolean, error: string, side?: boolean }>()
const emit = defineEmits<{ reload: [], collapse: [], sent: [queued: QueuedMessage | null], prefill: [prefix: string] }>()

const DONE_SHOWN = 20

// ------------------------------------------------------------ tabs
type PanelTab = 'tasks' | 'threads' | 'inbox' | 'routines' | 'settings' | 'memory'
const TABS: { key: PanelTab, label: string }[] = [
  { key: 'tasks', label: tl('Tasks', 'Tâches') },
  { key: 'threads', label: 'Threads' },
  { key: 'inbox', label: 'Inbox' },
  { key: 'routines', label: 'Routines' },
  { key: 'settings', label: t('Settings') },
  { key: 'memory', label: tl('Memory', 'Mémoire') },
]
const saved = tabByPane.get(props.paneId)
const tab = ref<PanelTab>(TABS.some(x => x.key === saved) ? saved as PanelTab : 'tasks')
function setTab(key: PanelTab) {
  if (tab.value === key) return
  tab.value = key
  tabByPane.set(props.paneId, key)
  haptic()
}
// The bar scrolls sideways when the tabs do not fit: the picked one stays in view.
function pickTab(key: PanelTab, e: MouseEvent) {
  setTab(key)
  ;(e.currentTarget as HTMLElement).scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
}
// Tabs hidden past an edge of the bar: that edge fades.
const tabBar = useTemplateRef<HTMLElement>('tabBar')
const more = ref({ left: false, right: false })
function measureTabs() {
  const el = tabBar.value
  if (!el) return
  more.value = { left: el.scrollLeft > 2, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 2 }
}
let tabsSeen: ResizeObserver | null = null
watch(tabBar, (el) => {
  tabsSeen?.disconnect()
  tabsSeen = null
  if (!el) return
  measureTabs()
  if (typeof ResizeObserver !== 'undefined') {
    tabsSeen = new ResizeObserver(measureTabs)
    tabsSeen.observe(el)
  }
  // The tab kept from an earlier visit may be out of view.
  el.querySelector<HTMLElement>('.pp-tab.on')?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
}, { flush: 'post' })
onUnmounted(() => tabsSeen?.disconnect())
// Arrow keys move between tabs, as in any tab list.
function onTabKey(e: KeyboardEvent) {
  const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
  if (!step) return
  e.preventDefault()
  const next = TABS[(TABS.findIndex(x => x.key === tab.value) + step + TABS.length) % TABS.length]!
  const bar = e.currentTarget as HTMLElement
  setTab(next.key)
  nextTick(() => {
    const on = bar.querySelector<HTMLElement>('.pp-tab.on')
    on?.focus()
    on?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  })
}
// Unhandled inbox items: known once the Inbox tab was opened.
const inboxCount = ref<number | null>(null)
const tabCount = (key: PanelTab) => (key === 'threads' && props.board ? props.board.open.length : key === 'inbox' ? inboxCount.value : null)
// Refresh re-reads the board (the parent) and the tab's own list.
const refreshTick = ref(0)
function refresh() {
  refreshTick.value++
  emit('reload')
}
// An inbox item about a thread: its agent if it runs, otherwise its report.
function openInboxThread(th: ProjectThread) {
  const live = coordinator.value && props.board && threadLivePane(coordinator.value, props.board.slug, th)
  if (live || th.report) openCard(th)
  else setTab('threads')
}

const sections = computed<BoardSection[]>(() => (props.board ? visibleSections(boardSections(props.board, { doing: t('In progress'), done: tl('Done', 'Fait') }), projectHideEmpty.value) : []))

const ICONS: Record<ListKind, string> = {
  test: 'i-lucide-flask-conical',
  decide: 'i-lucide-signpost',
  review: 'i-lucide-git-pull-request',
  blocked: 'i-lucide-octagon-alert',
  doing: 'i-lucide-activity',
  queue: 'i-lucide-list-ordered',
  todo: 'i-lucide-list-todo',
  backlog: 'i-lucide-archive',
  done: 'i-lucide-circle-check',
}
const icon = (k: ListKind | null) => (k ? ICONS[k] : 'i-lucide-list')

// Collapsed sections: "Done" by default, the rest open.
const folded = ref<Record<string, boolean>>({})
const isOpen = (s: BoardSection) => !(folded.value[s.key] ?? s.kind === 'done')
function toggle(s: BoardSection) {
  folded.value = { ...folded.value, [s.key]: isOpen(s) }
  haptic()
}
const count = (s: BoardSection) => s.tasks.filter(x => !x.done).length + s.threads.length

// ------------------------------------------------------------ threads
// The panel's own coordinator pane: the thread panes are looked up from its machine.
const coordinator = computed(() => herdrState.value.panes.find(p => p.id === props.paneId))
function openCard(th: ProjectThread) {
  if (coordinator.value && props.board) openThread(coordinator.value, props.board.slug, th)
}

const allOpen = ref(false)

// ------------------------------------------------------------ messages to the coordinator
// Sent actions (module-level store, shared with the Board) give way to "Sent"
// until the coordinator removes the task from its list. One task message at a
// time, app-wide (`taskSending`).
const lang = () => (language === 'en' ? 'en' : 'fr')
const acting = taskSending
watch(() => props.board, (b) => { if (b) pruneSent(props.paneId, b) }, { immediate: true })

async function act(kind: ListKind | null, action: BoardAction, task: string, message: string) {
  const queued = await sendTask(props.paneId, kind, action, task, message)
  if (queued === false) return
  // Up / Down can be repeated (the row stays, so a toast confirms); the others are sent once.
  if (action === 'up' || action === 'down') toast(t('Sent to the coordinator'))
  emit('sent', queued)
}

const testable = (s: BoardSection, task: ProjectTask) => s.kind === 'test' && !task.done
const decidable = (s: BoardSection, task: ProjectTask) => s.kind === 'decide' && !task.done
const launchable = (s: BoardSection, task: ProjectTask) => s.kind === 'backlog' && !task.done
const unblockable = (s: BoardSection, task: ProjectTask) => s.kind === 'blocked' && !task.done
const reviewable = (s: BoardSection, task: ProjectTask) => s.kind === 'review' && !task.done
const orderable = (s: BoardSection, task: ProjectTask) => (s.kind === 'todo' || s.kind === 'queue') && !task.done
// An In progress task whose thread has no live card (threads unreadable, or not
// listed): the action of the card, on the task. Not for a closed thread.
const informable = (s: BoardSection, task: ProjectTask) => s.kind === 'doing' && !task.done && Boolean(task.thread) && !props.board?.resolved.some(x => x.id === task.thread)
const actionable = (s: BoardSection, task: ProjectTask) => testable(s, task) || decidable(s, task) || launchable(s, task) || unblockable(s, task) || reviewable(s, task) || orderable(s, task) || informable(s, task)

// Any action already sent for the task (from here or from the Board): its actions give way to "Sent".
const taskSent = (s: BoardSection, task: ProjectTask) => (testable(s, task) || launchable(s, task) || unblockable(s, task) || reviewable(s, task) || orderable(s, task))
  && isTaskSent(props.paneId, s.kind, task.text)

// ------------------------------------------------------------ to do / in queue
const moveKey = (s: BoardSection, action: MoveAction, task: ProjectTask) => sentKey(s.kind, action, task.text)
const pending = (s: BoardSection) => s.tasks.filter(x => !x.done)
const isFirst = (s: BoardSection, task: ProjectTask) => pending(s)[0] === task
const isLast = (s: BoardSection, task: ProjectTask) => pending(s).at(-1) === task
const moveTask = (s: BoardSection, task: ProjectTask, action: MoveAction) => act(s.kind, action, task.text, moveMessage(action, task.text, lang()))
// "In queue" header: thread slots in use and the next task.
const slotLine = (s: BoardSection) => (s.kind === 'queue' ? queueStatus(props.board?.slots, pending(s)[0]?.text, lang()) : null)
// Global limit of the coordinator's machine, all projects (Settings › Plugins).
const machineLine = (s: BoardSection) => (s.kind === 'queue' ? machineSlotsLine(props.board?.machineSlots, lang()) : null)
const machineFull = computed(() => Boolean(props.board?.machineSlots && props.board.machineSlots.open >= props.board.machineSlots.max))
const reviewTask = (task: ProjectTask) => act('review', 'reviewed', task.text, reviewedMessage(task.text, lang()))
const confirmTask = (task: ProjectTask) => act('test', 'tested', task.text, testedMessage(task.text, lang()))
const launchTask = (task: ProjectTask) => act('backlog', 'launch', task.text, launchMessage(task.text, lang()))
const unblockTask = (task: ProjectTask) => act('blocked', 'unblock', task.text, unblockMessage(task.text, lang()))
function prefill(task: ProjectTask, kind: 'problem' | 'question' | 'decision' | 'detail' | 'comment') {
  haptic()
  const prefix = { problem: problemPrefix, question: questionPrefix, decision: decisionPrefix, detail: detailPrefix, comment: reviewCommentPrefix }[kind]
  emit('prefill', prefix(task.text, lang()))
}

// ------------------------------------------------------------ add info
// Text for a working thread, through the coordinator. A text left unsent is
// kept per thread while the panel stays open.
const info = ref<{ id: string, title: string } | null>(null)
const infoOpen = ref(false)
const infoText = ref('')
const infoSending = ref(false)
const infoField = ref<{ textareaRef?: HTMLTextAreaElement } | null>(null)
const infoDrafts = new Map<string, string>()
function addInfo(id: string, title: string) {
  haptic()
  info.value = { id, title }
  infoText.value = infoDrafts.get(id) || ''
  infoOpen.value = true
  setTimeout(() => infoField.value?.textareaRef?.focus(), 80)
}
watch(infoText, (v) => { if (info.value) infoDrafts.set(info.value.id, v) })
async function sendInfo() {
  const target = info.value
  if (!target || infoSending.value || !infoText.value.trim()) return
  infoSending.value = true
  haptic()
  try {
    const queued = await sendToCoordinator(props.paneId, infoMessage(target.id, infoText.value, lang()))
    if (queued === false) return
    infoOpen.value = false
    infoText.value = ''
    infoDrafts.delete(target.id)
    toast(t('Sent to the coordinator'))
    emit('sent', queued)
  } catch (e) { toast((e as Error).message, true) }
  finally { infoSending.value = false }
}

// ------------------------------------------------------------ suggestion
// "To test" or "To decide" missing from TASKS.md: a discreet line points
// to Settings › Plugins (hidden for good once closed).
const HINT_KEY = 'hw-project-hint-off'
const hintOff = ref(false)
onMounted(() => { try { hintOff.value = localStorage.getItem(HINT_KEY) === '1' } catch {} })
const missing = computed(() => (props.board && !props.board.tasksMissing ? missingLists(props.board.lists) : []))
const hintText = computed(() => {
  const names = missing.value.map(k => (k === 'test' ? tl('“To test”', '« À tester »') : tl('“To decide”', '« À décider »')))
  return tl(`No ${names.join(' or ')} list in TASKS.md.`, `Pas de liste ${names.join(' ni ')} dans TASKS.md.`)
})
function hideHint() {
  hintOff.value = true
  try { localStorage.setItem(HINT_KEY, '1') } catch {}
}

</script>

<template>
  <aside class="project-panel" :class="{ side }" :aria-label="t('Project')">
    <header class="pp-head">
      <span class="pp-kicker">{{ t('Project') }}</span>
      <span v-if="board" class="pp-slug">{{ board.slug }}</span>
      <span class="pp-grow" />
      <UTooltip :text="t('Refresh')" :disabled="!desk">
        <UButton icon="i-lucide-refresh-cw" color="neutral" variant="ghost" size="sm" class="icon-btn pp-btn" :class="{ spinning: loading }" :aria-label="t('Refresh')" @click="refresh" />
      </UTooltip>
      <UTooltip v-if="side" :text="t('Collapse the panel')">
        <UButton icon="i-lucide-panel-right-close" color="neutral" variant="ghost" size="sm" class="icon-btn pp-btn" :aria-label="t('Collapse the panel')" @click="emit('collapse')" />
      </UTooltip>
    </header>

    <div v-if="board" class="pp-tabs-wrap" :class="{ 'more-left': more.left, 'more-right': more.right }">
    <div ref="tabBar" class="pp-tabs" role="tablist" :aria-label="tl('Project sections', 'Sections du projet')" @keydown="onTabKey" @scroll.passive="measureTabs">
      <button
        v-for="x in TABS" :id="`pp-tab-${x.key}`" :key="x.key" type="button" role="tab" class="pp-tab" :class="{ on: tab === x.key }"
        :aria-selected="tab === x.key" :tabindex="tab === x.key ? 0 : -1" @click="pickTab(x.key, $event)"
      >
        <span>{{ x.label }}</span><span v-if="tabCount(x.key) !== null" class="pp-tab-n">{{ tabCount(x.key) }}</span>
      </button>
    </div>
    </div>

    <div class="pp-scroll" role="tabpanel" :aria-labelledby="board ? `pp-tab-${tab}` : undefined">
      <p v-if="error && !board" class="pp-notice error" role="alert">{{ error }}</p>
      <p v-if="!board && loading" class="pp-notice"><span class="spinner" /> {{ t('Reading the project…') }}</p>
      <p v-if="board?.threadsError" class="pp-notice error">{{ t('Threads unavailable') }} · <code>{{ board.threadsError }}</code></p>
      <ProjectThreads v-if="board && tab === 'threads'" :pane-id="paneId" :board="board" @reload="emit('reload')" @report="openThreadReport(paneId, $event)" @agent="openCard" />
      <ProjectInbox v-else-if="board && tab === 'inbox'" :pane-id="paneId" :board="board" :tick="refreshTick" @count="inboxCount = $event" @thread="openInboxThread" />
      <ProjectRoutines v-else-if="board && tab === 'routines'" :pane-id="paneId" :board="board" :tick="refreshTick" />
      <ProjectSettings v-else-if="board && tab === 'settings'" :pane-id="paneId" :board="board" :tick="refreshTick" />
      <ProjectMemory v-else-if="board && tab === 'memory'" :pane-id="paneId" :board="board" :tick="refreshTick" />
      <template v-else-if="board">
        <p v-if="board.tasksMissing" class="pp-notice">{{ t('No TASKS.md in this project yet.') }}</p>
        <p v-if="missing.length && !hintOff" class="pp-hint">
          <span>{{ hintText }} <NuxtLink to="/settings?section=plugins">{{ tl('See the convention', 'Voir la convention') }}</NuxtLink></span>
          <button type="button" class="pp-hint-x" :aria-label="tl('Hide the suggestion', 'Masquer la suggestion')" @click="hideHint"><UIcon name="i-lucide-x" /></button>
        </p>

        <section v-for="s in sections" :key="s.key" class="pp-sec" :class="[s.kind, { folded: !isOpen(s) }]">
          <button type="button" class="pp-sec-head" :aria-expanded="isOpen(s)" @click="toggle(s)">
            <UIcon :name="icon(s.kind)" class="pp-sec-icon" />
            <span class="pp-sec-title">{{ s.title }}</span>
            <span class="pp-count">{{ count(s) }}</span>
            <UIcon name="i-lucide-chevron-down" class="pp-chev" />
          </button>
          <p v-if="isOpen(s) && slotLine(s)" class="pp-slots">{{ slotLine(s) }}</p>
          <p v-if="isOpen(s) && machineLine(s)" class="pp-slots machine" :class="{ full: machineFull }">{{ machineLine(s) }}</p>
          <ul v-if="isOpen(s)" class="pp-list">
            <!-- Threads: open (In progress) or closed (Done, 20 most recent). -->
            <li v-for="th in (s.kind === 'done' ? s.threads.slice(0, DONE_SHOWN) : s.threads)" :key="th.id" class="pp-row">
              <div class="pp-card" :class="{ resolved: th.resolved }">
                <button type="button" class="pp-thread" @click="th.resolved ? openThreadReport(paneId, th) : openCard(th)">
                  <span v-if="!th.resolved" class="pill" :class="threadClass(th)"><i />{{ threadLabel(th) }}</span>
                  <span class="pp-thread-title">{{ th.title }}</span>
                  <span class="pp-meta">{{ threadMeta(th) }}</span>
                </button>
                <UTooltip v-if="!th.resolved" :text="tl('Add info for this thread', 'Ajouter une info pour ce thread')" :disabled="!desk">
                  <UButton
                    icon="i-lucide-message-square-plus" color="neutral" variant="ghost" size="sm" class="icon-btn pp-btn pp-info-btn"
                    :aria-label="tl(`Add info: ${th.title}`, `Ajouter une info : ${th.title}`)" @click="addInfo(th.id, th.title)"
                  />
                </UTooltip>
                <UButton
                  v-if="th.report && !th.resolved" icon="i-lucide-file-text" color="neutral" variant="ghost" size="sm" class="icon-btn pp-btn"
                  :loading="threadReportLoading === th.id" :aria-label="t('View report')" @click="openThreadReport(paneId, th)"
                />
                <span v-else-if="threadReportLoading === th.id" class="spinner pp-spin" />
              </div>
            </li>
            <li
              v-for="(task, i) in s.tasks" :key="`t${i}`" class="pp-row pp-task"
              :class="{ done: task.done, testable: testable(s, task), decidable: decidable(s, task), launchable: launchable(s, task), unblockable: unblockable(s, task), reviewable: reviewable(s, task), sent: taskSent(s, task), orderable: orderable(s, task) }"
            >
              <span class="pp-box" aria-hidden="true" />
              <template v-if="!actionable(s, task)">
                <span v-if="task.reason" class="pp-task-body"><span class="pp-task-text"><TaskText :text="task.text" /></span><span class="pp-reason">{{ task.reason }}</span></span>
                <span v-else class="pp-task-text"><TaskText :text="task.text" /></span>
                <span v-if="task.badges && coordinator" class="pp-tags">
                  <TaskBadges :badges="task.badges" :coordinator="coordinator" :board="board" />
                </span>
              </template>
              <!-- To test / To decide / Backlog: text across the full width; below,
                   the owner and the section's actions. -->
              <span v-else class="pp-task-body">
                <span class="pp-task-text"><TaskText :text="task.text" /></span>
                <span v-if="task.reason" class="pp-reason">{{ task.reason }}</span>
                <span class="pp-task-foot">
                  <span v-if="taskSent(s, task)" class="pp-sent"><UIcon name="i-lucide-send" />{{ t('Sent to the coordinator') }}</span>
                  <TaskBadges v-if="task.badges && coordinator" :badges="task.badges" :coordinator="coordinator" :board="board" />
                  <span v-if="informable(s, task) || decidable(s, task) || launchable(s, task) || unblockable(s, task) || ((reviewable(s, task) || testable(s, task) || orderable(s, task)) && !taskSent(s, task))" class="pp-verdict" :class="{ wrap: orderable(s, task) }">
                    <template v-if="orderable(s, task)">
                      <UTooltip :text="tl('Move up', 'Monter')" :disabled="!desk">
                        <button type="button" class="pp-vbtn move" :disabled="acting !== null || isFirst(s, task)" :aria-label="tl(`Move up: ${task.text}`, `Monter : ${task.text}`)" @click="moveTask(s, task, 'up')">
                          <span v-if="acting === moveKey(s, 'up', task)" class="spinner" /><UIcon v-else name="i-lucide-arrow-up" />
                        </button>
                      </UTooltip>
                      <UTooltip :text="tl('Move down', 'Descendre')" :disabled="!desk">
                        <button type="button" class="pp-vbtn move" :disabled="acting !== null || isLast(s, task)" :aria-label="tl(`Move down: ${task.text}`, `Descendre : ${task.text}`)" @click="moveTask(s, task, 'down')">
                          <span v-if="acting === moveKey(s, 'down', task)" class="spinner" /><UIcon v-else name="i-lucide-arrow-down" />
                        </button>
                      </UTooltip>
                      <UTooltip v-if="s.kind === 'todo'" :text="tl('Queue it: launched automatically when a thread slot frees', 'Mettre en file : lancé automatiquement dès qu’une place de thread se libère')" :disabled="!desk">
                        <button type="button" class="pp-vbtn backlog-action queue" :disabled="acting !== null" :aria-label="tl(`Queue it: ${task.text}`, `Mettre en file : ${task.text}`)" @click="moveTask(s, task, 'queue')">
                          <span v-if="acting === moveKey(s, 'queue', task)" class="spinner" /><UIcon v-else name="i-lucide-list-plus" /><span>{{ tl('Queue', 'En file') }}</span>
                        </button>
                      </UTooltip>
                      <UTooltip :text="s.kind === 'queue' ? tl('Launch now, ahead of the queue', 'Lancer maintenant, avant la file') : tl('Launch now if a thread slot is free, otherwise first in the queue', 'Lancer maintenant si une place de thread est libre, sinon en tête de file')" :disabled="!desk">
                        <button type="button" class="pp-vbtn backlog-action launch" :disabled="acting !== null" :aria-label="tl(`Launch now: ${task.text}`, `Lancer maintenant : ${task.text}`)" @click="moveTask(s, task, 'now')">
                          <span v-if="acting === moveKey(s, 'now', task)" class="spinner" /><UIcon v-else name="i-lucide-play" /><span>{{ tl('Launch', 'Lancer') }}</span>
                        </button>
                      </UTooltip>
                      <UTooltip :text="tl('Clarify this task', 'Préciser cette tâche')" :disabled="!desk">
                        <button type="button" class="pp-vbtn clarify" :aria-label="tl(`Clarify: ${task.text}`, `Préciser : ${task.text}`)" @click="prefill(task, 'detail')">
                          <UIcon name="i-lucide-pencil" />
                        </button>
                      </UTooltip>
                      <UTooltip v-if="s.kind === 'todo'" :text="tl('Back to backlog', 'Remettre au backlog')" :disabled="!desk">
                        <button type="button" class="pp-vbtn park" :disabled="acting !== null" :aria-label="tl(`Back to backlog: ${task.text}`, `Remettre au backlog : ${task.text}`)" @click="moveTask(s, task, 'backlog')">
                          <span v-if="acting === moveKey(s, 'backlog', task)" class="spinner" /><UIcon v-else name="i-lucide-archive" />
                        </button>
                      </UTooltip>
                      <UTooltip v-else :text="tl('Remove from queue (back to To do)', 'Retirer de la file (retour en À faire)')" :disabled="!desk">
                        <button type="button" class="pp-vbtn park" :disabled="acting !== null" :aria-label="tl(`Remove from queue: ${task.text}`, `Retirer de la file : ${task.text}`)" @click="moveTask(s, task, 'unqueue')">
                          <span v-if="acting === moveKey(s, 'unqueue', task)" class="spinner" /><UIcon v-else name="i-lucide-list-x" />
                        </button>
                      </UTooltip>
                    </template>
                    <UTooltip v-if="informable(s, task)" :text="tl('Add info for this thread', 'Ajouter une info pour ce thread')" :disabled="!desk">
                      <button type="button" class="pp-vbtn backlog-action info" :aria-label="tl(`Add info: ${task.text}`, `Ajouter une info : ${task.text}`)" @click="addInfo(task.thread!, task.text)">
                        <UIcon name="i-lucide-message-square-plus" /><span>{{ tl('Add info', 'Ajouter info') }}</span>
                      </button>
                    </UTooltip>
                    <UTooltip v-if="reviewable(s, task)" :text="tl('Reviewed: tell the coordinator', 'Relu : prévenir le coordinateur')" :disabled="!desk">
                      <button type="button" class="pp-vbtn backlog-action reviewed" :disabled="acting !== null" :aria-label="tl(`Reviewed: ${task.text}`, `Relu : ${task.text}`)" @click="reviewTask(task)">
                        <span v-if="acting === sentKey('review', 'reviewed', task.text)" class="spinner" /><UIcon v-else name="i-lucide-check" /><span>{{ tl('Reviewed', 'Relu') }}</span>
                      </button>
                    </UTooltip>
                    <UTooltip v-if="reviewable(s, task)" :text="tl('Draft review feedback', 'Préparer un retour de relecture')" :disabled="!desk">
                      <button type="button" class="pp-vbtn backlog-action clarify" :aria-label="tl(`Comment: ${task.text}`, `Commenter : ${task.text}`)" @click="prefill(task, 'comment')">
                        <UIcon name="i-lucide-message-square" /><span>{{ tl('Comment', 'Commenter') }}</span>
                      </button>
                    </UTooltip>
                    <UTooltip v-if="testable(s, task)" :text="t('Confirm: tested, it works')" :disabled="!desk">
                      <button
                        type="button" class="pp-vbtn ok" :disabled="acting !== null"
                        :aria-label="tl(`Confirm: ${task.text}`, `Confirmer : ${task.text}`)" @click="confirmTask(task)"
                      >
                        <span v-if="acting === sentKey('test', 'tested', task.text)" class="spinner" /><UIcon v-else name="i-lucide-check" />
                      </button>
                    </UTooltip>
                    <UTooltip v-if="testable(s, task)" :text="t('Report a problem')" :disabled="!desk">
                      <button type="button" class="pp-vbtn ko" :aria-label="tl(`Problem: ${task.text}`, `Problème : ${task.text}`)" @click="prefill(task, 'problem')">
                        <UIcon name="i-lucide-x" />
                      </button>
                    </UTooltip>
                    <UTooltip v-if="testable(s, task) || decidable(s, task)" :text="t('Ask a question')" :disabled="!desk">
                      <button type="button" class="pp-vbtn ask" :aria-label="tl(`Question: ${task.text}`, `Question : ${task.text}`)" @click="prefill(task, 'question')">
                        <UIcon name="i-lucide-circle-help" />
                      </button>
                    </UTooltip>
                    <UTooltip v-if="decidable(s, task)" :text="tl('Answer this decision', 'Répondre à cette décision')" :disabled="!desk">
                      <button type="button" class="pp-vbtn decide" :aria-label="tl(`Answer: ${task.text}`, `Répondre : ${task.text}`)" @click="prefill(task, 'decision')">
                        <UIcon name="i-lucide-reply" />
                      </button>
                    </UTooltip>
                    <UTooltip v-if="launchable(s, task) && !taskSent(s, task)" :text="tl('Send to coordinator', 'Envoyer au coordinateur')" :disabled="!desk">
                      <button type="button" class="pp-vbtn backlog-action launch" :disabled="acting !== null" :aria-label="tl(`Launch: ${task.text}`, `Lancer : ${task.text}`)" @click="launchTask(task)">
                        <span v-if="acting === sentKey('backlog', 'launch', task.text)" class="spinner" /><UIcon v-else name="i-lucide-play" /><span>{{ t('Launch') }}</span>
                      </button>
                    </UTooltip>
                    <UTooltip v-if="unblockable(s, task) && !taskSent(s, task)" :text="tl('Ask to unblock this task', 'Demander de débloquer cette tâche')" :disabled="!desk">
                      <button type="button" class="pp-vbtn backlog-action unblock" :disabled="acting !== null" :aria-label="tl(`Unblock: ${task.text}`, `Débloquer : ${task.text}`)" @click="unblockTask(task)">
                        <span v-if="acting === sentKey('blocked', 'unblock', task.text)" class="spinner" /><UIcon v-else name="i-lucide-lock-keyhole-open" /><span>{{ tl('Unblock', 'Débloquer') }}</span>
                      </button>
                    </UTooltip>
                    <UTooltip v-if="launchable(s, task) || unblockable(s, task)" :text="tl('Clarify this task', 'Préciser cette tâche')" :disabled="!desk">
                      <button type="button" class="pp-vbtn backlog-action clarify" :aria-label="tl(`Clarify: ${task.text}`, `Préciser : ${task.text}`)" @click="prefill(task, 'detail')">
                        <UIcon name="i-lucide-pencil" /><span>{{ t('Clarify') }}</span>
                      </button>
                    </UTooltip>
                  </span>
                </span>
              </span>
            </li>
            <li v-if="!s.tasks.length && !s.threads.length" class="pp-empty">{{ t('Nothing yet') }}</li>
          </ul>
          <button v-if="isOpen(s) && s.kind === 'done' && s.threads.length > DONE_SHOWN" type="button" class="pp-more" @click="allOpen = true">
            {{ tl(`See all (${s.threads.length})`, `Tout voir (${s.threads.length})`) }}
          </button>
        </section>
      </template>
    </div>

    <AppSheet v-model:open="allOpen" :title="tl(`Done · ${board?.resolved.length || 0} threads`, `Fait · ${board?.resolved.length || 0} threads`)" wide screen>
      <ul class="pp-list pp-all">
        <li v-for="th in board?.resolved || []" :key="th.id" class="pp-row">
          <div class="pp-card resolved">
            <button type="button" class="pp-thread" @click="openThreadReport(paneId, th)">
              <span class="pp-thread-title">{{ th.title }}</span>
              <span class="pp-meta">{{ threadMeta(th) }}</span>
            </button>
            <span v-if="threadReportLoading === th.id" class="spinner pp-spin" />
          </div>
        </li>
      </ul>
    </AppSheet>

    <AppSheet v-model:open="infoOpen" :title="tl('Add info', 'Ajouter une info')" screen>
      <form v-if="info" id="pp-info-form" class="rename sheet-form pp-info" @submit.prevent="sendInfo">
        <p class="pp-info-for"><span class="pp-info-id">{{ info.id.toUpperCase() }}</span><span class="pp-info-title">{{ info.title }}</span></p>
        <UTextarea
          ref="infoField" v-model="infoText" :rows="5" autoresize :maxrows="12" size="xl" class="w-full"
          :aria-label="tl('Info for the thread', 'Info pour le thread')"
          :placeholder="tl('What the thread should know…', 'Ce que le thread doit savoir…')"
          @keydown.enter.meta.prevent="sendInfo" @keydown.enter.ctrl.prevent="sendInfo"
        />
        <p class="plugin-input-hint">{{ tl('Sent to the coordinator, which passes it on to the thread as is.', 'Envoyé au coordinateur, qui le transmet tel quel au thread.') }}</p>
      </form>
      <template #footer>
        <div class="rename-actions">
          <UButton color="neutral" variant="ghost" class="sheet-btn" :disabled="infoSending" @click="infoOpen = false">{{ t('Cancel') }}</UButton>
          <UButton type="submit" form="pp-info-form" color="primary" variant="solid" class="sheet-btn hw-cta" :loading="infoSending" :disabled="!infoText.trim()">{{ t('Send') }}</UButton>
        </div>
      </template>
    </AppSheet>
  </aside>
</template>
