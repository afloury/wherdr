<script lang="ts">
// Filter typed in the Threads tab, per pane: kept when switching tabs.
const queryByPane = new Map<string, string>()
// Action in progress on a thread (`<pane>|<thread>`). Kept here, outside the
// component: leaving the tab or closing the record while an action runs (a
// resolve may take minutes) must not offer its buttons again.
const runningByThread = reactive(new Map<string, string>())
</script>

<script setup lang="ts">
// "Threads" tab of the Project panel: every thread of the project as
// herdr-projects lists it. Open threads under their group (Waiting on you
// first), resolved ones in their own collapsed section, by pages. One filter
// for both (ID, title, machine, profile).
// Tapping a thread opens its record (`thread show`): state, Next list, facts,
// and its actions, each run by herdr-projects on the coordinator's machine:
// Acknowledge, Restart, Stop and Resolve (the last two ask first).
import type { Pane } from '#shared/types'
import type { ProjectBoard, ProjectThread } from '#shared/projectBoard'
import { type ThreadAction, type ThreadDetail, CONFIRMED_ACTIONS, filterThreads, groupThreads, lastLine, threadActionsFor } from '#shared/projectThreads'

const props = defineProps<{ paneId: string, board: ProjectBoard }>()
const emit = defineEmits<{ reload: [], report: [th: ProjectThread], agent: [th: ProjectThread] }>()

const RESOLVED_PAGE = 30

const query = ref(queryByPane.get(props.paneId) || '')
watch(query, v => queryByPane.set(props.paneId, v))
const open = computed(() => filterThreads(props.board.open, query.value))
const resolved = computed(() => filterThreads(props.board.resolved, query.value))
const groups = computed(() => groupThreads(open.value))

// Resolved threads: collapsed until asked for, or until the filter finds some.
const resolvedOpen = ref(false)
const resolvedShown = ref(RESOLVED_PAGE)
const showResolved = computed(() => resolvedOpen.value || (Boolean(query.value.trim()) && resolved.value.length > 0))
watch(query, () => { resolvedShown.value = RESOLVED_PAGE })
function toggleResolved() {
  resolvedOpen.value = !showResolved.value
  haptic()
}

const GROUPS: Record<string, [string, string]> = {
  'waiting-on-you': ['blocked', t('Your turn')],
  'ready-for-review': ['done', t('Ready for review')],
  'landing': ['working', t('Landing')],
  'working': ['working', t('Working')],
  'idle': ['idle', t('Idle')],
  'resolved': ['idle', tl('Resolved', 'Clôturé')],
}
const groupClass = (token: string) => GROUPS[token]?.[0] || 'unknown'
const groupLabel = (token: string, fallback: string) => GROUPS[token]?.[1] || fallback || t('Unknown')
function paneOf(th: ProjectThread): Pane | undefined {
  return th.agentName ? herdrState.value.panes.find(p => p.name === th.agentName) : undefined
}
function meta(th: ProjectThread) {
  const bits = [th.id.toUpperCase()]
  if (th.machine) bits.push(th.machine)
  if (th.profile) bits.push(th.profile)
  if (!th.resolved && th.percent !== null) bits.push(`${th.percent} %`)
  if (!th.resolved && th.activity) bits.push(th.activity)
  const when = th.updated && fmtWhen(th.updated)
  if (when) bits.push(when)
  return bits.join(' · ')
}

// ------------------------------------------------------------ record
const current = ref<ProjectThread | null>(null)
const detail = shallowRef<ThreadDetail | null>(null)
const detailOpen = ref(false)
const detailLoading = ref(false)
const detailError = ref('')
// What herdr-projects printed for the last action on this thread.
const output = ref('')
let seq = 0
async function loadDetail() {
  const th = current.value
  if (!th) return
  const id = ++seq
  detailLoading.value = true
  detailError.value = ''
  try {
    const r = await fetchThreadDetail(props.paneId, th.id)
    if (id === seq) detail.value = r.thread
  } catch (e) {
    if (id === seq) detailError.value = (e as Error).message
  } finally {
    if (id === seq) detailLoading.value = false
  }
}
function openDetail(th: ProjectThread) {
  haptic()
  current.value = th
  detail.value = null
  output.value = ''
  detailOpen.value = true
  loadDetail()
}
// The row's data until the record arrives, then the record.
const shown = computed<ProjectThread | null>(() => detail.value || current.value)
const shownPane = computed(() => (shown.value ? paneOf(shown.value) : undefined))
const actions = computed<ThreadAction[]>(() => (detail.value ? threadActionsFor(detail.value) : []))
const facts = computed(() => {
  const d = detail.value
  const th = shown.value
  if (!th) return []
  const rows: [string, string][] = [
    [tl('Machine', 'Machine'), th.machine || tl('The project’s machine', 'Celle du projet')],
    [tl('Profile', 'Profil'), d && d.agent && d.agent !== th.profile ? `${th.profile} (${d.agent})` : th.profile],
  ]
  if (d?.branch) rows.push([tl('Branch', 'Branche'), d.base ? `${d.branch} ← ${d.base}` : d.branch])
  if (d?.kind) rows.push([tl('Kind', 'Type'), d.kind === 'worktree' ? tl('Worktree', 'Worktree') : d.kind === 'tab' ? tl('Tab', 'Onglet') : d.kind])
  if (d?.prState || d?.prReview) rows.push([t('Pull request'), [d.prState, d.prReview].filter(Boolean).join(' · ')])
  if (th.created && fmtWhen(th.created)) rows.push([tl('Created', 'Créé'), fmtWhen(th.created)])
  if (th.updated && fmtWhen(th.updated)) rows.push([tl('Updated', 'Mis à jour'), fmtWhen(th.updated)])
  if (d?.resolved && d.keptWorktree) rows.push([tl('Worktree', 'Worktree'), tl('Kept', 'Conservé')])
  return rows.filter(r => r[1])
})

// ------------------------------------------------------------ actions
const LABELS: Record<ThreadAction, { label: string, icon: string, hint: string }> = {
  ack: { label: tl('Acknowledge', 'Marquer vu'), icon: 'i-lucide-eye', hint: tl('Record that you have seen its report', 'Noter que tu as vu son rapport') },
  restart: { label: t('Restart'), icon: 'i-lucide-rotate-cw', hint: tl('Bring back a thread whose pane is gone or whose start failed', 'Relancer un thread dont le pane a disparu ou dont le démarrage a échoué') },
  stop: { label: tl('Stop', 'Arrêter'), icon: 'i-lucide-square', hint: tl('Send Escape to its agent', 'Envoyer Échap à son agent') },
  resolve: { label: tl('Resolve', 'Clôturer'), icon: 'i-lucide-circle-check', hint: tl('Close the thread and clean up its worktree, merged branch and tab', 'Clôturer le thread et nettoyer son worktree, sa branche fusionnée et son onglet') },
}
const runKey = (id: string) => `${props.paneId}|${id}`
// The action running on the thread shown, started from this tab or before leaving it.
const running = computed(() => (shown.value ? runningByThread.get(runKey(shown.value.id)) as ThreadAction | undefined : undefined) ?? null)
function confirmText(action: ThreadAction, th: ProjectThread): string {
  const id = th.id.toUpperCase()
  if (action === 'stop') {
    return tl(`Stop ${id}?\n${th.title}\n\nEscape is sent to its agent: the turn in progress is interrupted.`,
      `Arrêter ${id} ?\n${th.title}\n\nÉchap est envoyé à son agent : le tour en cours est interrompu.`)
  }
  return tl(`Resolve ${id}?\n${th.title}\n\nIts worktree, its branch once merged and its tab are removed. Its report and library are kept.`,
    `Clôturer ${id} ?\n${th.title}\n\nSon worktree, sa branche une fois fusionnée et son onglet sont supprimés. Son rapport et sa bibliothèque sont conservés.`)
}
async function run(action: ThreadAction) {
  const th = shown.value
  if (!th || running.value) return
  if (!eventsOpen.value || offlineView.value) return toast(tl('Thread actions are unavailable offline', 'Actions des threads indisponibles hors ligne'), true)
  haptic()
  if (CONFIRMED_ACTIONS.includes(action) && !(await askConfirm(confirmText(action, th), LABELS[action].label, 'error'))) return
  // Asked again while the question was open, or from another record of the same thread.
  const key = runKey(th.id)
  if (runningByThread.has(key)) return
  runningByThread.set(key, action)
  try {
    const r = await runThreadAction(props.paneId, th.id, action)
    output.value = r.output
    toast(lastLine(r.output) || tl(`${LABELS[action].label}: done`, `${LABELS[action].label} : fait`))
    emit('reload')
    await loadDetail()
  } catch (e) { toast((e as Error).message, true) }
  finally { runningByThread.delete(key) }
}
function openAgent() {
  if (!shown.value) return
  detailOpen.value = false
  emit('agent', shown.value)
}
function openReport() {
  if (!shown.value) return
  detailOpen.value = false
  emit('report', shown.value)
}
</script>

<template>
  <div class="pt">
    <div v-if="board.open.length + board.resolved.length > 0" class="pt-filter">
      <NameFilter v-model="query" :label="tl('Filter threads', 'Filtrer les threads')" />
    </div>

    <section v-for="g in groups" :key="g.token" class="pt-group">
      <h3 class="pt-group-head">
        <span class="pill" :class="groupClass(g.token)"><i />{{ groupLabel(g.token, g.group) }}</span>
        <span class="pp-count">{{ g.threads.length }}</span>
      </h3>
      <ul class="pp-list">
        <li v-for="th in g.threads" :key="th.id" class="pp-row">
          <div class="pp-card">
            <button type="button" class="pp-thread pt-thread" :aria-label="tl(`Thread ${th.id}: ${th.title}`, `Thread ${th.id} : ${th.title}`)" @click="openDetail(th)">
              <span class="pp-thread-title">{{ th.title }}</span>
              <span class="pp-meta">{{ meta(th) }}</span>
            </button>
            <UIcon name="i-lucide-chevron-right" class="pt-go" />
          </div>
        </li>
      </ul>
    </section>
    <p v-if="!open.length" class="pp-empty pt-none">{{ query.trim() ? tl('No open thread matches', 'Aucun thread ouvert ne correspond') : tl('No open thread', 'Aucun thread ouvert') }}</p>

    <section class="pp-sec done pt-resolved" :class="{ folded: !showResolved }">
      <button type="button" class="pp-sec-head" :aria-expanded="showResolved" @click="toggleResolved">
        <UIcon name="i-lucide-circle-check" class="pp-sec-icon" />
        <span class="pp-sec-title">{{ tl('Resolved', 'Clôturés') }}</span>
        <span class="pp-count">{{ resolved.length }}</span>
        <UIcon name="i-lucide-chevron-down" class="pp-chev" />
      </button>
      <ul v-if="showResolved" class="pp-list">
        <li v-for="th in resolved.slice(0, resolvedShown)" :key="th.id" class="pp-row">
          <div class="pp-card resolved">
            <button type="button" class="pp-thread pt-thread" :aria-label="tl(`Thread ${th.id}: ${th.title}`, `Thread ${th.id} : ${th.title}`)" @click="openDetail(th)">
              <span class="pp-thread-title">{{ th.title }}</span>
              <span class="pp-meta">{{ meta(th) }}</span>
            </button>
            <UIcon name="i-lucide-chevron-right" class="pt-go" />
          </div>
        </li>
        <li v-if="!resolved.length" class="pp-empty">{{ t('Nothing yet') }}</li>
      </ul>
      <button v-if="showResolved && resolved.length > resolvedShown" type="button" class="pp-more" @click="resolvedShown += RESOLVED_PAGE">
        {{ tl(`Show more (${resolved.length - resolvedShown} left)`, `Voir plus (${resolved.length - resolvedShown} restants)`) }}
      </button>
    </section>

    <AppSheet v-model:open="detailOpen" :title="shown ? `${shown.id.toUpperCase()} · ${shown.title}` : ''" wide tall screen>
      <div v-if="shown" class="pt-detail">
        <p class="pt-state">
          <span class="pill" :class="groupClass(shown.token)"><i />{{ groupLabel(shown.token, shown.group) }}</span>
          <span v-if="shown.stateLine" class="pt-state-line">{{ shown.stateLine }}</span>
          <span v-if="detailLoading" class="spinner pt-spin" />
        </p>
        <p v-if="detailError" class="pp-notice error" role="alert">
          <span>{{ tl('Thread record unavailable', 'Fiche du thread indisponible') }} · <code>{{ detailError }}</code></span>
          <UButton size="xs" color="neutral" variant="outline" @click="loadDetail">{{ tl('Retry', 'Réessayer') }}</UButton>
        </p>
        <p v-if="detail?.error" class="pp-notice error"><code>{{ detail.error }}</code></p>

        <section v-if="detail?.next.length" class="pt-block">
          <h4 class="pt-label">{{ tl('Next', 'Ensuite') }}</h4>
          <ol class="pt-next">
            <li v-for="(line, i) in detail.next" :key="i"><span class="pt-next-n">{{ i + 1 }}</span><span>{{ line }}</span></li>
          </ol>
        </section>

        <div class="pt-links">
          <UButton v-if="shownPane" icon="i-lucide-message-square" color="neutral" variant="outline" class="pt-btn" @click="openAgent">{{ t('Open agent') }}</UButton>
          <UButton v-if="shown.report" icon="i-lucide-file-text" color="neutral" variant="outline" class="pt-btn" @click="openReport">{{ t('View report') }}</UButton>
          <UButton v-if="shown.pr" icon="i-lucide-git-pull-request" color="neutral" variant="outline" class="pt-btn" :to="shown.pr" target="_blank" rel="noopener noreferrer">{{ t('Pull request') }}</UButton>
        </div>

        <section v-if="actions.length" class="pt-block">
          <h4 class="pt-label">{{ tl('Actions', 'Actions') }}</h4>
          <div class="pt-actions">
            <UTooltip v-for="a in actions" :key="a" :text="LABELS[a].hint" :disabled="!desk">
              <UButton
                :icon="LABELS[a].icon" :color="a === 'resolve' || a === 'stop' ? 'error' : 'neutral'" variant="outline" class="pt-btn" :class="`pt-act-${a}`"
                :loading="running === a" :disabled="running !== null" @click="run(a)"
              >
                {{ LABELS[a].label }}
              </UButton>
            </UTooltip>
          </div>
        </section>
        <pre v-if="output" class="pt-output">{{ output }}</pre>

        <dl class="pt-facts">
          <div v-for="[k, v] in facts" :key="k"><dt>{{ k }}</dt><dd>{{ v }}</dd></div>
        </dl>
      </div>
    </AppSheet>
  </div>
</template>
