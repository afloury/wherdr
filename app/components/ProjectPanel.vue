<script lang="ts">
// Tâches « À tester » confirmées, par pane : gardées en changeant d'onglet,
// jusqu'à ce que le coordinateur les retire de TASKS.md.
const confirmedByPane = new Map<string, Set<string>>()
const launchedByPane = new Map<string, Set<string>>()
const unblockedByPane = new Map<string, Set<string>>()
</script>

<script setup lang="ts">
// Panneau « Projet » du coordinateur herdr-projects, en lecture seule : les
// listes de TASKS.md dans leur ordre (noms connus avec une icône), les threads
// ouverts dans « En cours » (état donné par herdr-projects, relu quand un agent
// du projet change d'état), les threads clôturés dans « Fait » (20 plus récents,
// section repliée, « tout voir »). Toucher un thread ouvert ouvre son agent ;
// toucher un rapport l'affiche.
// « À tester » : chaque tâche a Confirmer (message « ✓ Testé : … » envoyé au
// coordinateur), Problème (« ✗ Problème : … — ») et Question (« ? Question : … — »),
// ces deux-là mis dans son champ de saisie (émis vers la vue de l'agent).
// « À décider » : Question et Répondre préparent aussi un brouillon.
// « Backlog » : Lancer envoie le message ; Préciser prépare un brouillon.
// Le fichier n'est jamais écrit d'ici.
// `side` : colonne à droite de la conversation (ordinateur), repliable.
import type { Pane, QueuedMessage } from '#shared/types'
import { type BoardSection, type ListKind, type ProjectBoard, type ProjectTask, type ProjectThread, boardSections, decisionPrefix, detailPrefix, launchMessage, missingLists, ownerIsMe, problemPrefix, questionPrefix, testedMessage, unblockMessage } from '#shared/projectBoard'
import { md } from '~/utils/markdown'

const props = defineProps<{ paneId: string, board: ProjectBoard | null, loading: boolean, error: string, side?: boolean }>()
const emit = defineEmits<{ reload: [], collapse: [], sent: [queued: QueuedMessage | null], prefill: [prefix: string] }>()

const DONE_SHOWN = 20

const sections = computed<BoardSection[]>(() => (props.board ? boardSections(props.board, { doing: t('En cours'), done: t('Fait') }) : []))

const ICONS: Record<ListKind, string> = {
  test: 'i-lucide-flask-conical',
  decide: 'i-lucide-signpost',
  blocked: 'i-lucide-octagon-alert',
  doing: 'i-lucide-activity',
  backlog: 'i-lucide-list-todo',
  done: 'i-lucide-circle-check',
}
const icon = (k: ListKind | null) => (k ? ICONS[k] : 'i-lucide-list')

// Sections repliées : « Fait » par défaut, le reste ouvert.
const folded = ref<Record<string, boolean>>({})
const isOpen = (s: BoardSection) => !(folded.value[s.key] ?? s.kind === 'done')
function toggle(s: BoardSection) {
  folded.value = { ...folded.value, [s.key]: isOpen(s) }
  haptic()
}
const count = (s: BoardSection) => s.tasks.filter(x => !x.done).length + s.threads.length

// ------------------------------------------------------------ threads
// Agent d'un thread dans wherdr (même nom de pane), s'il tourne encore.
function paneOf(th: ProjectThread): Pane | undefined {
  return th.agentName ? herdrState.value.panes.find(p => p.name === th.agentName) : undefined
}
const GROUPS: Record<string, [string, string]> = {
  'waiting-on-you': ['blocked', t('À toi')],
  'ready-for-review': ['done', t('À relire')],
  'landing': ['working', t('Atterrissage')],
  'working': ['working', t('Au travail')],
  'idle': ['idle', t('Inactif')],
  'resolved': ['idle', t('Fait')],
}
const groupClass = (th: ProjectThread) => GROUPS[th.token]?.[0] || 'unknown'
const groupLabel = (th: ProjectThread) => GROUPS[th.token]?.[1] || th.group || t('Inconnu')
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
  else toast(t('Agent de ce thread introuvable'), true)
}

const allOpen = ref(false)

// ------------------------------------------------------------ rapport
const report = ref<{ th: ProjectThread, html: string, truncated: boolean } | null>(null)
const reportOpen = ref(false)
const reportLoading = ref<string | null>(null)
async function openReport(th: ProjectThread) {
  if (!th.report) return toast(t('Pas de rapport pour ce thread'), true)
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

// ------------------------------------------------------------ à tester
const lang = () => (language === 'en' ? 'en' : 'fr')
const confirmed = ref(new Set(confirmedByPane.get(props.paneId) || []))
const confirming = ref<string | null>(null)
const launched = ref(new Set(launchedByPane.get(props.paneId) || []))
const launching = ref<string | null>(null)
const unblocked = ref(new Set(unblockedByPane.get(props.paneId) || []))
const unblocking = ref<string | null>(null)
// Tâche retirée de « À tester » par le coordinateur : on l'oublie.
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
}, { immediate: true })

const testable = (s: BoardSection, task: ProjectTask) => s.kind === 'test' && !task.done
const decidable = (s: BoardSection, task: ProjectTask) => s.kind === 'decide' && !task.done
const launchable = (s: BoardSection, task: ProjectTask) => s.kind === 'backlog' && !task.done
const unblockable = (s: BoardSection, task: ProjectTask) => s.kind === 'blocked' && !task.done
async function confirmTask(task: ProjectTask) {
  if (confirming.value || confirmed.value.has(task.text)) return
  const pane = herdrState.value.panes.find(p => p.id === props.paneId)
  if (!eventsOpen.value || offlineView.value || paneStale(pane)) return toast(t('Envoi indisponible hors ligne'), true)
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
  if (!eventsOpen.value || offlineView.value || paneStale(pane)) return toast(t('Envoi indisponible hors ligne'), true)
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
  if (!eventsOpen.value || offlineView.value || paneStale(pane)) return toast(t('Envoi indisponible hors ligne'), true)
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
function prefill(task: ProjectTask, kind: 'problem' | 'question' | 'decision' | 'detail') {
  haptic()
  const prefix = { problem: problemPrefix, question: questionPrefix, decision: decisionPrefix, detail: detailPrefix }[kind]
  emit('prefill', prefix(task.text, lang()))
}

// ------------------------------------------------------------ suggestion
// « À tester » ou « À décider » absents de TASKS.md : une ligne discrète renvoie
// vers Réglages › Plugins (masquée pour de bon une fois fermée).
const HINT_KEY = 'hw-project-hint-off'
const hintOff = ref(false)
onMounted(() => { try { hintOff.value = localStorage.getItem(HINT_KEY) === '1' } catch {} })
const missing = computed(() => (props.board && !props.board.tasksMissing ? missingLists(props.board.lists) : []))
const hintText = computed(() => {
  const names = missing.value.map(k => (k === 'test' ? tl('« À tester »', '“To test”') : tl('« À décider »', '“To decide”')))
  return tl(`Pas de liste ${names.join(' ni ')} dans TASKS.md.`, `No ${names.join(' or ')} list in TASKS.md.`)
})
function hideHint() {
  hintOff.value = true
  try { localStorage.setItem(HINT_KEY, '1') } catch {}
}

// ------------------------------------------------------------ tâches
function ownerLabel(task: ProjectTask) {
  if (!task.owner) return ''
  if (ownerIsMe(task.owner)) return t('toi')
  if (task.thread) return task.thread
  return task.owner
}
</script>

<template>
  <aside class="project-panel" :class="{ side }" :aria-label="t('Projet')">
    <header class="pp-head">
      <span class="pp-kicker">{{ t('Projet') }}</span>
      <span v-if="board" class="pp-slug">{{ board.slug }}</span>
      <span class="pp-grow" />
      <UTooltip :text="t('Rafraîchir')" :disabled="!desk">
        <UButton icon="i-lucide-refresh-cw" color="neutral" variant="ghost" size="sm" class="icon-btn pp-btn" :class="{ spinning: loading }" :aria-label="t('Rafraîchir')" @click="emit('reload')" />
      </UTooltip>
      <UTooltip v-if="side" :text="t('Replier le panneau')">
        <UButton icon="i-lucide-panel-right-close" color="neutral" variant="ghost" size="sm" class="icon-btn pp-btn" :aria-label="t('Replier le panneau')" @click="emit('collapse')" />
      </UTooltip>
    </header>

    <div class="pp-scroll">
      <p v-if="error" class="pp-notice error" role="alert">{{ error }}</p>
      <p v-if="!board && loading" class="pp-notice"><span class="spinner" /> {{ t('Lecture du projet…') }}</p>
      <template v-if="board">
        <p v-if="board.tasksMissing" class="pp-notice">{{ t('Pas encore de TASKS.md dans ce projet.') }}</p>
        <p v-if="missing.length && !hintOff" class="pp-hint">
          <span>{{ hintText }} <NuxtLink to="/settings?section=plugins">{{ tl('Voir la convention', 'See the convention') }}</NuxtLink></span>
          <button type="button" class="pp-hint-x" :aria-label="tl('Masquer la suggestion', 'Hide the suggestion')" @click="hideHint"><UIcon name="i-lucide-x" /></button>
        </p>
        <p v-if="board.threadsError" class="pp-notice error">{{ t('Threads illisibles') }} · <code>{{ board.threadsError }}</code></p>

        <section v-for="s in sections" :key="s.key" class="pp-sec" :class="[s.kind, { folded: !isOpen(s) }]">
          <button type="button" class="pp-sec-head" :aria-expanded="isOpen(s)" @click="toggle(s)">
            <UIcon :name="icon(s.kind)" class="pp-sec-icon" />
            <span class="pp-sec-title">{{ s.title }}</span>
            <span class="pp-count">{{ count(s) }}</span>
            <UIcon name="i-lucide-chevron-down" class="pp-chev" />
          </button>
          <ul v-if="isOpen(s)" class="pp-list">
            <!-- Threads : ouverts (En cours) ou clôturés (Fait, 20 plus récents). -->
            <li v-for="th in (s.kind === 'done' ? s.threads.slice(0, DONE_SHOWN) : s.threads)" :key="th.id" class="pp-row">
              <div class="pp-card" :class="{ resolved: th.resolved }">
                <button type="button" class="pp-thread" @click="th.resolved ? openReport(th) : openThread(th)">
                  <span v-if="!th.resolved" class="pill" :class="groupClass(th)"><i />{{ groupLabel(th) }}</span>
                  <span class="pp-thread-title">{{ th.title }}</span>
                  <span class="pp-meta">{{ threadMeta(th) }}</span>
                </button>
                <UButton
                  v-if="th.report && !th.resolved" icon="i-lucide-file-text" color="neutral" variant="ghost" size="sm" class="icon-btn pp-btn"
                  :loading="reportLoading === th.id" :aria-label="t('Voir le rapport')" @click="openReport(th)"
                />
                <span v-else-if="reportLoading === th.id" class="spinner pp-spin" />
              </div>
            </li>
            <li
              v-for="(task, i) in s.tasks" :key="`t${i}`" class="pp-row pp-task"
              :class="{ done: task.done, mine: ownerIsMe(task.owner), testable: testable(s, task), decidable: decidable(s, task), launchable: launchable(s, task), unblockable: unblockable(s, task), sent: (testable(s, task) && confirmed.has(task.text)) || (launchable(s, task) && launched.has(task.text)) || (unblockable(s, task) && unblocked.has(task.text)) }"
            >
              <span class="pp-box" aria-hidden="true" />
              <template v-if="!testable(s, task) && !decidable(s, task) && !launchable(s, task) && !unblockable(s, task)">
                <span v-if="task.reason" class="pp-task-body"><span class="pp-task-text">{{ task.text }}</span><span class="pp-reason">{{ task.reason }}</span></span>
                <span v-else class="pp-task-text">{{ task.text }}</span>
                <span v-if="task.owner" class="pp-owner">{{ ownerLabel(task) }}</span>
              </template>
              <!-- À tester / À décider / Backlog : texte sur toute la largeur ; dessous,
                   le responsable et les actions de la section. -->
              <span v-else class="pp-task-body">
                <span class="pp-task-text">{{ task.text }}</span>
                <span v-if="task.reason" class="pp-reason">{{ task.reason }}</span>
                <span class="pp-task-foot">
                  <span v-if="testable(s, task) && confirmed.has(task.text)" class="pp-sent"><UIcon name="i-lucide-send" />{{ t('Envoyé au coordinateur') }}</span>
                  <span v-else-if="launchable(s, task) && launched.has(task.text)" class="pp-sent"><UIcon name="i-lucide-send" />{{ t('Envoyé au coordinateur') }}</span>
                  <span v-else-if="unblockable(s, task) && unblocked.has(task.text)" class="pp-sent"><UIcon name="i-lucide-send" />{{ t('Envoyé au coordinateur') }}</span>
                  <span v-else-if="task.owner" class="pp-owner">{{ ownerLabel(task) }}</span>
                  <span v-if="decidable(s, task) || launchable(s, task) || unblockable(s, task) || !confirmed.has(task.text)" class="pp-verdict">
                    <UTooltip v-if="testable(s, task)" :text="t('Confirmer : testé, ça marche')" :disabled="!desk">
                      <button
                        type="button" class="pp-vbtn ok" :disabled="confirming !== null"
                        :aria-label="tl(`Confirmer : ${task.text}`, `Confirm: ${task.text}`)" @click="confirmTask(task)"
                      >
                        <span v-if="confirming === task.text" class="spinner" /><UIcon v-else name="i-lucide-check" />
                      </button>
                    </UTooltip>
                    <UTooltip v-if="testable(s, task)" :text="t('Signaler un problème')" :disabled="!desk">
                      <button type="button" class="pp-vbtn ko" :aria-label="tl(`Problème : ${task.text}`, `Problem: ${task.text}`)" @click="prefill(task, 'problem')">
                        <UIcon name="i-lucide-x" />
                      </button>
                    </UTooltip>
                    <UTooltip v-if="testable(s, task) || decidable(s, task)" :text="t('Poser une question')" :disabled="!desk">
                      <button type="button" class="pp-vbtn ask" :aria-label="tl(`Question : ${task.text}`, `Question: ${task.text}`)" @click="prefill(task, 'question')">
                        <UIcon name="i-lucide-circle-help" />
                      </button>
                    </UTooltip>
                    <UTooltip v-if="decidable(s, task)" :text="tl('Répondre à cette décision', 'Answer this decision')" :disabled="!desk">
                      <button type="button" class="pp-vbtn decide" :aria-label="tl(`Répondre : ${task.text}`, `Answer: ${task.text}`)" @click="prefill(task, 'decision')">
                        <UIcon name="i-lucide-reply" />
                      </button>
                    </UTooltip>
                    <UTooltip v-if="launchable(s, task) && !launched.has(task.text)" :text="tl('Envoyer au coordinateur', 'Send to coordinator')" :disabled="!desk">
                      <button type="button" class="pp-vbtn backlog-action launch" :disabled="launching !== null" :aria-label="tl(`Lancer : ${task.text}`, `Launch: ${task.text}`)" @click="launchTask(task)">
                        <span v-if="launching === task.text" class="spinner" /><UIcon v-else name="i-lucide-play" /><span>{{ t('Lancer') }}</span>
                      </button>
                    </UTooltip>
                    <UTooltip v-if="unblockable(s, task) && !unblocked.has(task.text)" :text="tl('Demander de débloquer cette tâche', 'Ask to unblock this task')" :disabled="!desk">
                      <button type="button" class="pp-vbtn backlog-action unblock" :disabled="unblocking !== null" :aria-label="tl(`Débloquer : ${task.text}`, `Unblock: ${task.text}`)" @click="unblockTask(task)">
                        <span v-if="unblocking === task.text" class="spinner" /><UIcon v-else name="i-lucide-lock-keyhole-open" /><span>{{ tl('Débloquer', 'Unblock') }}</span>
                      </button>
                    </UTooltip>
                    <UTooltip v-if="launchable(s, task) || unblockable(s, task)" :text="tl('Préciser cette tâche', 'Clarify this task')" :disabled="!desk">
                      <button type="button" class="pp-vbtn backlog-action clarify" :aria-label="tl(`Préciser : ${task.text}`, `Clarify: ${task.text}`)" @click="prefill(task, 'detail')">
                        <UIcon name="i-lucide-pencil" /><span>{{ t('Préciser') }}</span>
                      </button>
                    </UTooltip>
                  </span>
                </span>
              </span>
            </li>
            <li v-if="!s.tasks.length && !s.threads.length" class="pp-empty">{{ t('Rien pour l’instant') }}</li>
          </ul>
          <button v-if="isOpen(s) && s.kind === 'done' && s.threads.length > DONE_SHOWN" type="button" class="pp-more" @click="allOpen = true">
            {{ tl(`Tout voir (${s.threads.length})`, `See all (${s.threads.length})`) }}
          </button>
        </section>
      </template>
    </div>

    <AppSheet v-model:open="allOpen" :title="tl(`Fait · ${board?.resolved.length || 0} threads`, `Done · ${board?.resolved.length || 0} threads`)" wide>
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

    <AppSheet v-model:open="reportOpen" :title="report ? `${report.th.id.toUpperCase()} · ${report.th.title}` : ''" wide tall>
      <div v-if="report" class="pp-report">
        <div class="pp-report-actions">
          <UButton v-if="reportPane" icon="i-lucide-message-square" color="neutral" variant="outline" size="sm" @click="openReportAgent">{{ t('Ouvrir l’agent') }}</UButton>
          <UButton v-if="report.th.pr" icon="i-lucide-git-pull-request" color="neutral" variant="outline" size="sm" :to="report.th.pr" target="_blank" rel="noopener">{{ t('Pull request') }}</UButton>
        </div>
        <div class="md"><ChatMarkdown :html="report.html" :typing="null" /></div>
        <p v-if="report.truncated" class="pp-notice">{{ t('Rapport tronqué (trop long).') }}</p>
      </div>
    </AppSheet>
  </aside>
</template>
