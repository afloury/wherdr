<script lang="ts">
// Confirmed "To test" tasks, per pane: kept when switching tabs,
// until the coordinator removes them from TASKS.md.
const confirmedByPane = new Map<string, Set<string>>()
const launchedByPane = new Map<string, Set<string>>()
const unblockedByPane = new Map<string, Set<string>>()
const reviewedByPane = new Map<string, Set<string>>()
// "To do" / "In queue" moves sent (`kind|action|task`), until the task leaves that list.
const movedByPane = new Map<string, Set<string>>()
</script>

<script setup lang="ts">
// "Project" panel of the herdr-projects coordinator, read-only: the
// TASKS.md lists in their order (known names with an icon), the threads
// open in "In progress" (state given by herdr-projects, re-read when an agent
// of the project changes state), the closed threads in "Done" (20 most recent,
// section collapsed, "see all"). Tapping an open thread opens its agent;
// tapping a report shows it.
// "To test": each task has Confirm (message "✓ Testé : …" sent to the
// coordinator), Problem ("✗ Problème : … — ") and Question ("? Question : … — "),
// the latter two put into its input field (emitted to the agent view).
// "To decide": Question and Answer also prepare a draft.
// "To review": Reviewed sends "✓ Relu : …", Comment prepares "↳ Retour sur
// … :" (the PR link: link badge or URL in the text, set by the coordinator).
// The only task decorations: the coordinator's [b:color(text)](target)
// badges; URLs in the text are plain links.
// "Backlog": Launch sends the message; Detail prepares a draft.
// "To do" / "In queue": Move up / Move down, Queue it, Launch now, Back to
// backlog / Remove from queue are sent as is; the coordinator edits TASKS.md.
// The "In queue" header shows the thread slots in use (PROJECT.md).
// The file is never written from here.
// `side`: column to the right of the conversation (computer), collapsible.
import type { Pane, QueuedMessage } from '#shared/types'
import { type BoardSection, type ListKind, type ProjectBoard, type ProjectTask, type ProjectThread, type TaskBadge, boardSections, visibleSections, decisionPrefix, detailPrefix, launchMessage, missingLists, moveMessage, type MoveAction, problemPrefix, queueStatus, questionPrefix, reviewCommentPrefix, reviewedMessage, testedMessage, textParts, unblockMessage } from '#shared/projectBoard'
import { md } from '~/utils/markdown'

const props = defineProps<{ paneId: string, board: ProjectBoard | null, loading: boolean, error: string, side?: boolean }>()
const emit = defineEmits<{ reload: [], collapse: [], sent: [queued: QueuedMessage | null], prefill: [prefix: string] }>()

const DONE_SHOWN = 20

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
// Agent of a thread in wherdr (same pane name), if it is still running.
function paneOf(th: ProjectThread): Pane | undefined {
  return th.agentName ? herdrState.value.panes.find(p => p.name === th.agentName) : undefined
}
const GROUPS: Record<string, [string, string]> = {
  'waiting-on-you': ['blocked', t('Your turn')],
  'ready-for-review': ['done', t('Ready for review')],
  'landing': ['working', t('Landing')],
  'working': ['working', t('Working')],
  'idle': ['idle', t('Idle')],
  'resolved': ['idle', tl('Done', 'Fait')],
}
const groupClass = (th: ProjectThread) => GROUPS[th.token]?.[0] || 'unknown'
const groupLabel = (th: ProjectThread) => GROUPS[th.token]?.[1] || th.group || t('Unknown')
function threadMeta(th: ProjectThread) {
  const bits = [th.id.toUpperCase()]
  if (th.machine) bits.push(th.machine)
  if (th.percent !== null && !th.resolved) bits.push(`${th.percent} %`)
  if (th.activity && !th.resolved) bits.push(th.activity)
  const when = th.updated && fmtWhen(th.updated)
  if (when) bits.push(when)
  return bits.join(' · ')
}

function openThread(th: ProjectThread) {
  const p = paneOf(th)
  if (p) {
    haptic()
    navigateTo(panePath(p.id))
  } else if (th.report) openReport(th)
  else toast(t('This thread’s agent was not found'), true)
}

// [b:color(text)](target) badges: palette (follows the theme) or validated hex;
// target URL (new tab) or thread (opens its tab if it exists).
const BADGE_MAX = 24
const badgeShort = (b: TaskBadge) => (b.text.length > BADGE_MAX ? `${b.text.slice(0, BADGE_MAX - 1)}…` : b.text)
const badgeClass = (b: TaskBadge) => [b.color?.startsWith('#') ? 'hex' : b.color ? `c-${b.color}` : '', { link: Boolean(b.href || b.thread) }]
const badgeStyle = (b: TaskBadge) => (b.color?.startsWith('#') ? { '--bc': b.color } : undefined)
function refThread(id: string): ProjectThread | undefined {
  return props.board?.open.find(x => x.id === id) || props.board?.resolved.find(x => x.id === id)
}
function badgeTitle(b: TaskBadge) {
  if (b.href) return b.href
  if (b.thread) {
    const th = refThread(b.thread)
    if (!th) return tl(`${b.thread}: unknown thread`, `${b.thread} : thread inconnu`)
    return `${b.thread} · ${th.title} · ${groupLabel(th)}${paneOf(th) ? '' : tl(' · no open tab', ' · pas d’onglet ouvert')}`
  }
  return b.text.length > BADGE_MAX ? b.text : undefined
}
function openBadgeThread(id: string) {
  const th = refThread(id)
  if (th && paneOf(th)) openThread(th)
  else toast(badgeTitle({ text: id, color: null, thread: id })!, true)
}

// Text of a task (URL → plain link) and its badges, rendered inline.
const TaskText = (p: { text: string }) => textParts(p.text).map(x => (x.href
  ? h('a', { class: 'pp-tlink', href: x.href, target: '_blank', rel: 'noopener noreferrer', onClick: (e: Event) => e.stopPropagation() }, x.text)
  : x.text))
TaskText.props = ['text']
const TaskBadges = (p: { badges: TaskBadge[] }) => p.badges.map((b, j) => {
  const inner = [badgeShort(b), b.href || b.thread ? h('i', { 'class': 'pp-badge-go', 'aria-hidden': 'true' }, '↗') : null]
  const common = { key: `b${j}`, class: ['pp-badge', ...badgeClass(b)], style: badgeStyle(b), title: badgeTitle(b) }
  if (b.href) return h('a', { ...common, href: b.href, target: '_blank', rel: 'noopener noreferrer', onClick: () => haptic() }, inner)
  if (b.thread) { const id = b.thread; return h('button', { ...common, type: 'button', onClick: () => openBadgeThread(id) }, inner) }
  return h('span', common, inner)
})
TaskBadges.props = ['badges']

const allOpen = ref(false)

// ------------------------------------------------------------ rapport
const report = ref<{ th: ProjectThread, html: string, truncated: boolean } | null>(null)
const reportOpen = ref(false)
const reportLoading = ref<string | null>(null)
async function openReport(th: ProjectThread) {
  if (!th.report) return toast(t('No report for this thread'), true)
  reportLoading.value = th.id
  try {
    const r = await fetchThreadReport(props.paneId, th.id)
    report.value = { th, html: md(r.text), truncated: r.truncated }
    reportOpen.value = true
    haptic()
  } catch (e) { toast((e as Error).message, true) }
  finally { reportLoading.value = null }
}
const reportPane = computed(() => (report.value ? paneOf(report.value.th) : undefined))
function openReportAgent() {
  const p = reportPane.value
  if (!p) return
  reportOpen.value = false
  navigateTo(panePath(p.id))
}

// ------------------------------------------------------------ to test
const lang = () => (language === 'en' ? 'en' : 'fr')
const confirmed = ref(new Set(confirmedByPane.get(props.paneId) || []))
const confirming = ref<string | null>(null)
const launched = ref(new Set(launchedByPane.get(props.paneId) || []))
const launching = ref<string | null>(null)
const unblocked = ref(new Set(unblockedByPane.get(props.paneId) || []))
const unblocking = ref<string | null>(null)
const reviewed = ref(new Set(reviewedByPane.get(props.paneId) || []))
const reviewing = ref<string | null>(null)
// Task removed from "To test" by the coordinator: we forget it.
watch(() => props.board, (b) => {
  if (!b) return
  const left = new Set(b.lists.filter(l => l.kind === 'test').flatMap(l => l.tasks.map(x => x.text)))
  const kept = new Set([...confirmed.value].filter(x => left.has(x)))
  if (kept.size !== confirmed.value.size) {
    confirmed.value = kept
    confirmedByPane.set(props.paneId, kept)
  }
  const backlog = new Set(b.lists.filter(l => l.kind === 'backlog').flatMap(l => l.tasks.map(x => x.text)))
  const keptLaunches = new Set([...launched.value].filter(x => backlog.has(x)))
  if (keptLaunches.size !== launched.value.size) {
    launched.value = keptLaunches
    launchedByPane.set(props.paneId, keptLaunches)
  }
  const blocked = new Set(b.lists.filter(l => l.kind === 'blocked').flatMap(l => l.tasks.map(x => x.text)))
  const keptUnblocks = new Set([...unblocked.value].filter(x => blocked.has(x)))
  if (keptUnblocks.size !== unblocked.value.size) {
    unblocked.value = keptUnblocks
    unblockedByPane.set(props.paneId, keptUnblocks)
  }
  const toReview = new Set(b.lists.filter(l => l.kind === 'review').flatMap(l => l.tasks.map(x => x.text)))
  const keptReviews = new Set([...reviewed.value].filter(x => toReview.has(x)))
  if (keptReviews.size !== reviewed.value.size) {
    reviewed.value = keptReviews
    reviewedByPane.set(props.paneId, keptReviews)
  }
  const keptMoves = new Set([...moved.value].filter((key) => {
    const [kind, , ...text] = key.split('|')
    return b.lists.some(l => l.kind === kind && l.tasks.some(x => x.text === text.join('|')))
  }))
  if (keptMoves.size !== moved.value.size) {
    moved.value = keptMoves
    movedByPane.set(props.paneId, keptMoves)
  }
}, { immediate: true })

const testable = (s: BoardSection, task: ProjectTask) => s.kind === 'test' && !task.done
const decidable = (s: BoardSection, task: ProjectTask) => s.kind === 'decide' && !task.done
const launchable = (s: BoardSection, task: ProjectTask) => s.kind === 'backlog' && !task.done
const unblockable = (s: BoardSection, task: ProjectTask) => s.kind === 'blocked' && !task.done
const reviewable = (s: BoardSection, task: ProjectTask) => s.kind === 'review' && !task.done
const orderable = (s: BoardSection, task: ProjectTask) => (s.kind === 'todo' || s.kind === 'queue') && !task.done
const actionable = (s: BoardSection, task: ProjectTask) => testable(s, task) || decidable(s, task) || launchable(s, task) || unblockable(s, task) || reviewable(s, task) || orderable(s, task)

// ------------------------------------------------------------ to do / in queue
const moved = ref(new Set(movedByPane.get(props.paneId) || []))
const moving = ref<string | null>(null)
const moveKey = (s: BoardSection, action: MoveAction, task: ProjectTask) => `${s.kind}|${action}|${task.text}`
// A task already queued, launched or sent back: its actions give way to "Sent".
const movedAway = (s: BoardSection, task: ProjectTask) => (['queue', 'now', 'unqueue', 'backlog'] as MoveAction[]).some(a => moved.value.has(moveKey(s, a, task)))
const pending = (s: BoardSection) => s.tasks.filter(x => !x.done)
const isFirst = (s: BoardSection, task: ProjectTask) => pending(s)[0] === task
const isLast = (s: BoardSection, task: ProjectTask) => pending(s).at(-1) === task
async function moveTask(s: BoardSection, task: ProjectTask, action: MoveAction) {
  const key = moveKey(s, action, task)
  if (moving.value || moved.value.has(key)) return
  const pane = herdrState.value.panes.find(p => p.id === props.paneId)
  if (!eventsOpen.value || offlineView.value || paneStale(pane)) return toast(t('Sending unavailable offline'), true)
  moving.value = key
  haptic()
  try {
    const queued = await sendMessage(pane, props.paneId, moveMessage(action, task.text, lang()))
    // Up / Down can be repeated (the row stays, so a toast confirms); the others are sent once.
    if (action === 'up' || action === 'down') toast(t('Sent to the coordinator'))
    else {
      moved.value = new Set([...moved.value, key])
      movedByPane.set(props.paneId, moved.value)
    }
    emit('sent', queued)
  } catch (e) { toast((e as Error).message, true) }
  finally { moving.value = null }
}
// "In queue" header: thread slots in use and the next task.
const slotLine = (s: BoardSection) => (s.kind === 'queue' ? queueStatus(props.board?.slots, pending(s)[0]?.text, lang()) : null)
async function reviewTask(task: ProjectTask) {
  if (reviewing.value || reviewed.value.has(task.text)) return
  const pane = herdrState.value.panes.find(p => p.id === props.paneId)
  if (!eventsOpen.value || offlineView.value || paneStale(pane)) return toast(t('Sending unavailable offline'), true)
  reviewing.value = task.text
  haptic()
  try {
    const queued = await sendMessage(pane, props.paneId, reviewedMessage(task.text, lang()))
    reviewed.value = new Set([...reviewed.value, task.text])
    reviewedByPane.set(props.paneId, reviewed.value)
    emit('sent', queued)
  } catch (e) { toast((e as Error).message, true) }
  finally { reviewing.value = null }
}
async function confirmTask(task: ProjectTask) {
  if (confirming.value || confirmed.value.has(task.text)) return
  const pane = herdrState.value.panes.find(p => p.id === props.paneId)
  if (!eventsOpen.value || offlineView.value || paneStale(pane)) return toast(t('Sending unavailable offline'), true)
  confirming.value = task.text
  haptic()
  try {
    const queued = await sendMessage(pane, props.paneId, testedMessage(task.text, lang()))
    confirmed.value = new Set([...confirmed.value, task.text])
    confirmedByPane.set(props.paneId, confirmed.value)
    emit('sent', queued)
  } catch (e) { toast((e as Error).message, true) }
  finally { confirming.value = null }
}
async function launchTask(task: ProjectTask) {
  if (launching.value || launched.value.has(task.text)) return
  const pane = herdrState.value.panes.find(p => p.id === props.paneId)
  if (!eventsOpen.value || offlineView.value || paneStale(pane)) return toast(t('Sending unavailable offline'), true)
  launching.value = task.text
  haptic()
  try {
    const queued = await sendMessage(pane, props.paneId, launchMessage(task.text, lang()))
    launched.value = new Set([...launched.value, task.text])
    launchedByPane.set(props.paneId, launched.value)
    emit('sent', queued)
  } catch (e) { toast((e as Error).message, true) }
  finally { launching.value = null }
}
async function unblockTask(task: ProjectTask) {
  if (unblocking.value || unblocked.value.has(task.text)) return
  const pane = herdrState.value.panes.find(p => p.id === props.paneId)
  if (!eventsOpen.value || offlineView.value || paneStale(pane)) return toast(t('Sending unavailable offline'), true)
  unblocking.value = task.text
  haptic()
  try {
    const queued = await sendMessage(pane, props.paneId, unblockMessage(task.text, lang()))
    unblocked.value = new Set([...unblocked.value, task.text])
    unblockedByPane.set(props.paneId, unblocked.value)
    emit('sent', queued)
  } catch (e) { toast((e as Error).message, true) }
  finally { unblocking.value = null }
}
function prefill(task: ProjectTask, kind: 'problem' | 'question' | 'decision' | 'detail' | 'comment') {
  haptic()
  const prefix = { problem: problemPrefix, question: questionPrefix, decision: decisionPrefix, detail: detailPrefix, comment: reviewCommentPrefix }[kind]
  emit('prefill', prefix(task.text, lang()))
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
        <UButton icon="i-lucide-refresh-cw" color="neutral" variant="ghost" size="sm" class="icon-btn pp-btn" :class="{ spinning: loading }" :aria-label="t('Refresh')" @click="emit('reload')" />
      </UTooltip>
      <UTooltip v-if="side" :text="t('Collapse the panel')">
        <UButton icon="i-lucide-panel-right-close" color="neutral" variant="ghost" size="sm" class="icon-btn pp-btn" :aria-label="t('Collapse the panel')" @click="emit('collapse')" />
      </UTooltip>
    </header>

    <div class="pp-scroll">
      <p v-if="error" class="pp-notice error" role="alert">{{ error }}</p>
      <p v-if="!board && loading" class="pp-notice"><span class="spinner" /> {{ t('Reading the project…') }}</p>
      <template v-if="board">
        <p v-if="board.tasksMissing" class="pp-notice">{{ t('No TASKS.md in this project yet.') }}</p>
        <p v-if="missing.length && !hintOff" class="pp-hint">
          <span>{{ hintText }} <NuxtLink to="/settings?section=plugins">{{ tl('See the convention', 'Voir la convention') }}</NuxtLink></span>
          <button type="button" class="pp-hint-x" :aria-label="tl('Hide the suggestion', 'Masquer la suggestion')" @click="hideHint"><UIcon name="i-lucide-x" /></button>
        </p>
        <p v-if="board.threadsError" class="pp-notice error">{{ t('Threads unavailable') }} · <code>{{ board.threadsError }}</code></p>

        <section v-for="s in sections" :key="s.key" class="pp-sec" :class="[s.kind, { folded: !isOpen(s) }]">
          <button type="button" class="pp-sec-head" :aria-expanded="isOpen(s)" @click="toggle(s)">
            <UIcon :name="icon(s.kind)" class="pp-sec-icon" />
            <span class="pp-sec-title">{{ s.title }}</span>
            <span class="pp-count">{{ count(s) }}</span>
            <UIcon name="i-lucide-chevron-down" class="pp-chev" />
          </button>
          <p v-if="isOpen(s) && slotLine(s)" class="pp-slots">{{ slotLine(s) }}</p>
          <ul v-if="isOpen(s)" class="pp-list">
            <!-- Threads: open (In progress) or closed (Done, 20 most recent). -->
            <li v-for="th in (s.kind === 'done' ? s.threads.slice(0, DONE_SHOWN) : s.threads)" :key="th.id" class="pp-row">
              <div class="pp-card" :class="{ resolved: th.resolved }">
                <button type="button" class="pp-thread" @click="th.resolved ? openReport(th) : openThread(th)">
                  <span v-if="!th.resolved" class="pill" :class="groupClass(th)"><i />{{ groupLabel(th) }}</span>
                  <span class="pp-thread-title">{{ th.title }}</span>
                  <span class="pp-meta">{{ threadMeta(th) }}</span>
                </button>
                <UButton
                  v-if="th.report && !th.resolved" icon="i-lucide-file-text" color="neutral" variant="ghost" size="sm" class="icon-btn pp-btn"
                  :loading="reportLoading === th.id" :aria-label="t('View report')" @click="openReport(th)"
                />
                <span v-else-if="reportLoading === th.id" class="spinner pp-spin" />
              </div>
            </li>
            <li
              v-for="(task, i) in s.tasks" :key="`t${i}`" class="pp-row pp-task"
              :class="{ done: task.done, testable: testable(s, task), decidable: decidable(s, task), launchable: launchable(s, task), unblockable: unblockable(s, task), reviewable: reviewable(s, task), sent: (reviewable(s, task) && reviewed.has(task.text)) || (testable(s, task) && confirmed.has(task.text)) || (launchable(s, task) && launched.has(task.text)) || (unblockable(s, task) && unblocked.has(task.text)) || (orderable(s, task) && movedAway(s, task)), orderable: orderable(s, task) }"
            >
              <span class="pp-box" aria-hidden="true" />
              <template v-if="!actionable(s, task)">
                <span v-if="task.reason" class="pp-task-body"><span class="pp-task-text"><TaskText :text="task.text" /></span><span class="pp-reason">{{ task.reason }}</span></span>
                <span v-else class="pp-task-text"><TaskText :text="task.text" /></span>
                <span v-if="task.badges" class="pp-tags">
                  <TaskBadges :badges="task.badges" />
                </span>
              </template>
              <!-- To test / To decide / Backlog: text across the full width; below,
                   the owner and the section's actions. -->
              <span v-else class="pp-task-body">
                <span class="pp-task-text"><TaskText :text="task.text" /></span>
                <span v-if="task.reason" class="pp-reason">{{ task.reason }}</span>
                <span class="pp-task-foot">
                  <span v-if="testable(s, task) && confirmed.has(task.text)" class="pp-sent"><UIcon name="i-lucide-send" />{{ t('Sent to the coordinator') }}</span>
                  <span v-else-if="launchable(s, task) && launched.has(task.text)" class="pp-sent"><UIcon name="i-lucide-send" />{{ t('Sent to the coordinator') }}</span>
                  <span v-else-if="unblockable(s, task) && unblocked.has(task.text)" class="pp-sent"><UIcon name="i-lucide-send" />{{ t('Sent to the coordinator') }}</span>
                  <span v-else-if="reviewable(s, task) && reviewed.has(task.text)" class="pp-sent"><UIcon name="i-lucide-send" />{{ t('Sent to the coordinator') }}</span>
                  <span v-else-if="orderable(s, task) && movedAway(s, task)" class="pp-sent"><UIcon name="i-lucide-send" />{{ t('Sent to the coordinator') }}</span>
                  <TaskBadges v-if="task.badges" :badges="task.badges" />
                  <span v-if="decidable(s, task) || launchable(s, task) || unblockable(s, task) || (reviewable(s, task) && !reviewed.has(task.text)) || (testable(s, task) && !confirmed.has(task.text)) || (orderable(s, task) && !movedAway(s, task))" class="pp-verdict" :class="{ wrap: orderable(s, task) }">
                    <template v-if="orderable(s, task)">
                      <UTooltip :text="tl('Move up', 'Monter')" :disabled="!desk">
                        <button type="button" class="pp-vbtn move" :disabled="moving !== null || isFirst(s, task)" :aria-label="tl(`Move up: ${task.text}`, `Monter : ${task.text}`)" @click="moveTask(s, task, 'up')">
                          <span v-if="moving === moveKey(s, 'up', task)" class="spinner" /><UIcon v-else name="i-lucide-arrow-up" />
                        </button>
                      </UTooltip>
                      <UTooltip :text="tl('Move down', 'Descendre')" :disabled="!desk">
                        <button type="button" class="pp-vbtn move" :disabled="moving !== null || isLast(s, task)" :aria-label="tl(`Move down: ${task.text}`, `Descendre : ${task.text}`)" @click="moveTask(s, task, 'down')">
                          <span v-if="moving === moveKey(s, 'down', task)" class="spinner" /><UIcon v-else name="i-lucide-arrow-down" />
                        </button>
                      </UTooltip>
                      <UTooltip v-if="s.kind === 'todo'" :text="tl('Queue it: launched automatically when a thread slot frees', 'Mettre en file : lancé automatiquement dès qu’une place de thread se libère')" :disabled="!desk">
                        <button type="button" class="pp-vbtn backlog-action queue" :disabled="moving !== null" :aria-label="tl(`Queue it: ${task.text}`, `Mettre en file : ${task.text}`)" @click="moveTask(s, task, 'queue')">
                          <span v-if="moving === moveKey(s, 'queue', task)" class="spinner" /><UIcon v-else name="i-lucide-list-plus" /><span>{{ tl('Queue', 'En file') }}</span>
                        </button>
                      </UTooltip>
                      <UTooltip :text="s.kind === 'queue' ? tl('Launch now, ahead of the queue', 'Lancer maintenant, avant la file') : tl('Launch now if a thread slot is free, otherwise first in the queue', 'Lancer maintenant si une place de thread est libre, sinon en tête de file')" :disabled="!desk">
                        <button type="button" class="pp-vbtn backlog-action launch" :disabled="moving !== null" :aria-label="tl(`Launch now: ${task.text}`, `Lancer maintenant : ${task.text}`)" @click="moveTask(s, task, 'now')">
                          <span v-if="moving === moveKey(s, 'now', task)" class="spinner" /><UIcon v-else name="i-lucide-play" /><span>{{ tl('Launch', 'Lancer') }}</span>
                        </button>
                      </UTooltip>
                      <UTooltip :text="tl('Clarify this task', 'Préciser cette tâche')" :disabled="!desk">
                        <button type="button" class="pp-vbtn clarify" :aria-label="tl(`Clarify: ${task.text}`, `Préciser : ${task.text}`)" @click="prefill(task, 'detail')">
                          <UIcon name="i-lucide-pencil" />
                        </button>
                      </UTooltip>
                      <UTooltip v-if="s.kind === 'todo'" :text="tl('Back to backlog', 'Remettre au backlog')" :disabled="!desk">
                        <button type="button" class="pp-vbtn park" :disabled="moving !== null" :aria-label="tl(`Back to backlog: ${task.text}`, `Remettre au backlog : ${task.text}`)" @click="moveTask(s, task, 'backlog')">
                          <span v-if="moving === moveKey(s, 'backlog', task)" class="spinner" /><UIcon v-else name="i-lucide-archive" />
                        </button>
                      </UTooltip>
                      <UTooltip v-else :text="tl('Remove from queue (back to To do)', 'Retirer de la file (retour en À faire)')" :disabled="!desk">
                        <button type="button" class="pp-vbtn park" :disabled="moving !== null" :aria-label="tl(`Remove from queue: ${task.text}`, `Retirer de la file : ${task.text}`)" @click="moveTask(s, task, 'unqueue')">
                          <span v-if="moving === moveKey(s, 'unqueue', task)" class="spinner" /><UIcon v-else name="i-lucide-list-x" />
                        </button>
                      </UTooltip>
                    </template>
                    <UTooltip v-if="reviewable(s, task)" :text="tl('Reviewed: tell the coordinator', 'Relu : prévenir le coordinateur')" :disabled="!desk">
                      <button type="button" class="pp-vbtn backlog-action reviewed" :disabled="reviewing !== null" :aria-label="tl(`Reviewed: ${task.text}`, `Relu : ${task.text}`)" @click="reviewTask(task)">
                        <span v-if="reviewing === task.text" class="spinner" /><UIcon v-else name="i-lucide-check" /><span>{{ tl('Reviewed', 'Relu') }}</span>
                      </button>
                    </UTooltip>
                    <UTooltip v-if="reviewable(s, task)" :text="tl('Draft review feedback', 'Préparer un retour de relecture')" :disabled="!desk">
                      <button type="button" class="pp-vbtn backlog-action clarify" :aria-label="tl(`Comment: ${task.text}`, `Commenter : ${task.text}`)" @click="prefill(task, 'comment')">
                        <UIcon name="i-lucide-message-square" /><span>{{ tl('Comment', 'Commenter') }}</span>
                      </button>
                    </UTooltip>
                    <UTooltip v-if="testable(s, task)" :text="t('Confirm: tested, it works')" :disabled="!desk">
                      <button
                        type="button" class="pp-vbtn ok" :disabled="confirming !== null"
                        :aria-label="tl(`Confirm: ${task.text}`, `Confirmer : ${task.text}`)" @click="confirmTask(task)"
                      >
                        <span v-if="confirming === task.text" class="spinner" /><UIcon v-else name="i-lucide-check" />
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
                    <UTooltip v-if="launchable(s, task) && !launched.has(task.text)" :text="tl('Send to coordinator', 'Envoyer au coordinateur')" :disabled="!desk">
                      <button type="button" class="pp-vbtn backlog-action launch" :disabled="launching !== null" :aria-label="tl(`Launch: ${task.text}`, `Lancer : ${task.text}`)" @click="launchTask(task)">
                        <span v-if="launching === task.text" class="spinner" /><UIcon v-else name="i-lucide-play" /><span>{{ t('Launch') }}</span>
                      </button>
                    </UTooltip>
                    <UTooltip v-if="unblockable(s, task) && !unblocked.has(task.text)" :text="tl('Ask to unblock this task', 'Demander de débloquer cette tâche')" :disabled="!desk">
                      <button type="button" class="pp-vbtn backlog-action unblock" :disabled="unblocking !== null" :aria-label="tl(`Unblock: ${task.text}`, `Débloquer : ${task.text}`)" @click="unblockTask(task)">
                        <span v-if="unblocking === task.text" class="spinner" /><UIcon v-else name="i-lucide-lock-keyhole-open" /><span>{{ tl('Unblock', 'Débloquer') }}</span>
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
            <button type="button" class="pp-thread" @click="openReport(th)">
              <span class="pp-thread-title">{{ th.title }}</span>
              <span class="pp-meta">{{ threadMeta(th) }}</span>
            </button>
            <span v-if="reportLoading === th.id" class="spinner pp-spin" />
          </div>
        </li>
      </ul>
    </AppSheet>

    <AppSheet v-model:open="reportOpen" :title="report ? `${report.th.id.toUpperCase()} · ${report.th.title}` : ''" wide tall screen>
      <div v-if="report" class="pp-report">
        <div class="pp-report-actions">
          <UButton v-if="reportPane" icon="i-lucide-message-square" color="neutral" variant="outline" size="sm" @click="openReportAgent">{{ t('Open agent') }}</UButton>
          <UButton v-if="report.th.pr" icon="i-lucide-git-pull-request" color="neutral" variant="outline" size="sm" :to="report.th.pr" target="_blank" rel="noopener">{{ t('Pull request') }}</UButton>
        </div>
        <div class="md"><ChatMarkdown :html="report.html" :typing="null" /></div>
        <p v-if="report.truncated" class="pp-notice">{{ t('Report truncated (too long).') }}</p>
      </div>
    </AppSheet>
  </aside>
</template>
