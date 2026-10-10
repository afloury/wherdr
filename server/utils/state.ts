// Agent state: Herdr's `session.snapshot` reduced, enriched (on-screen
// questions, previews, queued messages) and broadcast on every change.
// Several machines: each machine is polled separately (a slow or
// broken machine does not delay the others); the broadcast state is their union, with
// remote machine IDs prefixed (see shared/ids.ts).
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import type { ChatItem, Choices, ClaudeQueueEntry, ClaudeScreen, HerdrState, InteractiveMenu, WaitScreen, MachineInfo, ModelInfo, OmpActivity, OmpStatus, Pane, QueuedMessage, ShellRun } from '../../shared/types'
import { ompActivityOf, parseOmpActivity, parseOmpShell, parseOmpStatus } from './ompScreen'
import { LOCAL, joinId, machineOf } from '../../shared/ids'
import { isProjectThread, paneTitle } from '../../shared/paneTitle'
import { foregroundCommand, reduceSnapshot } from './snapshot'
import { DATA_DIR, HERDR_SESSION, NOTIFY_SETTLE_MS, POLL_MS, log } from './env'
import { HerdrError, agentPrompt, herdr, herdrOn, sleep } from './herdr'
import { keepReading } from './screenCache'
import { type AskChecks, completeClaudeAsk, completeOmpAsk, ompActiveTab, parseChoices, parseOmpPrompt } from './choices'
import { isPermissionQuestion, mergeDetail } from './promptDetail'
import { parseWaitScreen } from './waitScreen'
import { parseMenu, TOP } from '../../shared/menuScreen'
import { settingsTabs } from '../../shared/settingsScreen'
import { parseClaudeActivity } from './activity'
import { parseClaudeNotice, parseClaudeScreen, parseClaudeSuggestion } from './claudeScreen'
import { type QueueEntry, INPUT_STATES, checkQueue, isUploadLine, loadQueued, nextHeld, ompRunShown, publicEntry, queuedDone } from './queued'
import { inputVisible } from './choices'
import { isSlashCommand, photosOnly } from '../../shared/queuedMatch'
import { findQueued, inputBox, msgText, unqueueClaude } from './unqueue'
import { takeBackInterrupted, unansweredTurn } from './interruptRestore'
import { interruptAgent } from './interruptSeq'
import { type SentRecord, addSent, findSent, hasAttachments, lostPhotos } from './sentHistory'
import { type GuardError, guardedSend, withPaneLock } from './guardedSend'
import { type TranscriptPane, sameMsg } from './transcripts'
import { agentNotificationTitle, pushSend, subWatchesSession } from './push'
import { shouldNotify } from './notificationPolicy'
import { currentModel, forgetModel, noteScreen } from './modelctl'
import { type Machine, RemoteMachine, allMachines, getMachine, machineOfPane, machinesListed, multiMachine, onMachinesChange, remoteMachines } from './machines'
import { READY_MAX_MS, serverReady } from '../../shared/stateReady'
import { createCodexStatus, dirWritable } from './codexStatus'
import { runLocal, setCodexKnownWeek } from './quotas'
import { createSelfUpdates } from './agentSelfUpdate'

const fsp = fs.promises

// Transcriptions : celles de la machine du pane (disque local, ou SSH).
function trFor(p: { id: string }) {
  const m = machineOfPane(p.id)
  if (!m) throw new HerdrError('unreachable', 'unknown machine')
  return m.transcripts
}
export const transcripts = {
  chat: (p: TranscriptPane, o: Parameters<Machine['transcripts']['chat']>[1] = {}) => trFor(p).chat(p, o),
  preview: (p: TranscriptPane) => trFor(p).preview(p),
  image: (p: TranscriptPane, file: string | null, ref: string | null, i: number) => trFor(p).image(p, file, ref, i),
  model: (p: TranscriptPane) => trFor(p).model(p),
  locate: (p: TranscriptPane) => trFor(p).locate(p),
  pendingTool: (p: TranscriptPane, tool?: string | null) => trFor(p).pendingTool(p, tool),
  pendingAsk: (p: TranscriptPane) => trFor(p).pendingAsk(p),
  pendingClaudeQuestions: (p: TranscriptPane) => trFor(p).pendingClaudeQuestions(p),
  forget: (id: string) => machineOfPane(id)?.transcripts.forget(id),
}

export { isUploadLine }

// ---------------------------------------------------------------- clients
// What each device is looking at (no notification for the agent shown on screen).
export interface EventClient { send: (data: string) => void, pane: string | null, visible: boolean }
export const eventClients = new Map<string, EventClient>()
export interface TermView { pane: string, visible: boolean }
export const termSessions = new Set<TermView>()

// ---------------------------------------------------------------- snapshot
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any

let state: HerdrState = { ok: false, error: 'starting…', workspaces: [], panes: [] }
// Last state of each machine (an offline machine's stays shown, grayed out).
const mstates = new Map<string, HerdrState>()
let stateJson = JSON.stringify(state)
export const getStateJson = () => stateJson
export const getState = () => state
export const findPane = (id: string | null | undefined) => state.panes.find(p => p.id === id)

// Visible screen in ANSI → interactive menu (null if there is none).
export async function readMenu(paneId: string): Promise<InteractiveMenu | null> {
  const r = await herdr('pane.read', { pane_id: paneId, source: 'visible', format: 'ansi' }, 4000)
  return parseMenu(r.read && r.read.text)
}
// omp "Ask" box with tabs: the tab shown, re-read in ANSI. Not found: no tabs
// (we could not tell how many ←/→ to send).
export async function withOmpTab(paneId: string, c: Choices): Promise<Choices> {
  if (!c.tabs || c.tab !== undefined) return c
  const r = await herdr('pane.read', { pane_id: paneId, source: 'visible', format: 'ansi' }, 4000)
  const tab = ompActiveTab(r.read && r.read.text, c.tabs)
  if (tab !== null) return { ...c, tab }
  const { tabs: _, ...rest } = c
  return rest
}

// Blocking prompts: re-read only when the pane's screen has changed
// (Herdr's `revision`), and forgotten as soon as the agent is no longer blocked.
// The waiting screen (key legend, see waitScreen.ts) is read at the same time.
// `watch`: Herdr's `revision` does not move when the screen of an idle agent
// changes (Codex starting, box closed from the terminal); we then re-read
// every SCREEN_MS while a prompt is shown, the agent is blocked or has no
// conversation (see screenCache.ts).
// Permission request: the requested command or file preferably comes from
// the transcript (in full), otherwise from the screen.
type OnScreen = { choices: Choices | null, screen: WaitScreen | null, menu: InteractiveMenu | null }
// Screen to re-read for a while even without a new `revision` ("/" command
// sent: an interactive menu may open), see watchScreen().
const screenWatch = new Map<string, number>()
export function watchScreen(paneId: string, ms = 60000) {
  screenWatch.set(paneId, Date.now() + ms)
  choicesCache.delete(paneId)
}
export const choicesCache = new Map<string, { rev: unknown, strict: boolean, at: number } & OnScreen>()
// Claude's checkboxes last seen ticked, per pane (see completeClaudeAsk).
const askChecks = new Map<string, AskChecks>()
async function choicesFor(p: Pane, rev: unknown, strict: boolean, watch = false): Promise<OnScreen> {
  const c = choicesCache.get(p.id)
  const watched = (screenWatch.get(p.id) || 0) > Date.now()
  if (!watched) screenWatch.delete(p.id)
  if (c && keepReading(c, rev, strict, watch || watched, Date.now())) return c
  let out: OnScreen
  try {
    const r = await herdr('pane.read', { pane_id: p.id, source: 'detection' }, 4000)
    const text = r.read && r.read.text
    // Claude Code interactive menu (/resume, /model…): re-read in ANSI (the
    // gray descriptions stand out from the entries there). Herdr considers some of them
    // blocking (/hooks, /mcp): a real question (numbered list) then keeps
    // priority; a simple cursor list there is read as a menu.
    const framed = String(text || '').split('\n').some((l: string) => TOP.test(l))
    // omp: its select dialog (tool approval) or "Ask" box (boxed, they would pass for a menu).
    let choices = p.agent === 'omp' ? parseOmpPrompt(text) : parseChoices(text, { strict })
    const menu = p.agent !== 'omp' && framed && (strict || !choices || !parseChoices(text, { strict: true })) ? await readMenu(p.id) : null
    if (menu) choices = null
    if (choices && p.agent === 'omp' && !choices.detail) choices = await withOmpTab(p.id, completeOmpAsk(choices, await transcripts.pendingAsk(p).catch(() => [])))
    // Claude's AskUserQuestion: full question and options from the call.
    if (choices && p.agent === 'claude') {
      const checks = askChecks.get(p.id) || new Map()
      askChecks.set(p.id, checks)
      choices = completeClaudeAsk(choices, await transcripts.pendingClaudeQuestions(p).catch(() => []), checks)
    } else if (!choices) askChecks.delete(p.id)
    // Claude Code's settings panel (/usage…): read-only, shown by the settings
    // card of the command result; its "Esc to cancel" is not a question.
    const settings = p.agent === 'claude' && settingsTabs(text) !== null
    out = { choices, screen: menu || settings ? null : parseWaitScreen(text, { choices: Boolean(choices) }), menu }
    noteScreen(p.id, p.agent, text) // Codex: model from its status line
    if (choices && (choices.detail || isPermissionQuestion(choices.question))) {
      // omp: the tool named in its dialog's title (none when scrolled off).
      const named = p.agent === 'omp' && choices.detail && choices.detail.tool !== 'tool' ? choices.detail.tool : null
      const tr = await transcripts.pendingTool(p, named).catch(() => null)
      const detail = mergeDetail(tr, choices.detail || null)
      if (detail) choices.detail = detail
      if (p.agent === 'omp' && !choices.question && tr) choices.question = `Allow tool: ${tr.tool}`
    }
  } catch { out = { choices: c ? c.choices : null, screen: c ? c.screen : null, menu: c ? c.menu : null } }
  choicesCache.set(p.id, { rev, strict, at: Date.now(), ...out })
  return out
}

// Preview (agent's last reply): refreshed in the background, without
// delaying the state broadcast.
const previews = new Map<string, { text: string | null, status: string | null, at: number }>()
const previewBusy = new Set<string>()
function refreshPreview(p: Pane) {
  if (previewBusy.has(p.id)) return
  previewBusy.add(p.id)
  transcripts.preview(p)
    .then(text => previews.set(p.id, { text, status: p.status, at: Date.now() }))
    .catch(() => {})
    .finally(() => previewBusy.delete(p.id))
}

// Claude's animated verb ("✢ Orbiting…"): read from the screen, only for a
// working Claude whose conversation is shown on a device, at most
// every ACTIVITY_MS; forgotten as soon as it stops working. Only the verb is
// broadcast (the duration and tokens would change the state every second).
// The same reading gives the running "!" command, its output, and the messages
// sent or still queued (see claudeScreen.ts); the start of the command is
// kept from one reading to the next (the counter does not change the state).
const ACTIVITY_MS = 1500
const NOTICE_MS = 5000
// When idle, the screen is read in ANSI for Claude's grayed-out suggestion
// (see parseClaudeSuggestion); it is only kept when not working.
const ANSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g // eslint-disable-line no-control-regex
type Activity = { verb: string | null, screen: ClaudeScreen | null, notice: string | null, suggestion: string | null, at: number }
const activities = new Map<string, Activity>()
const activityBusy = new Set<string>()
function refreshActivity(p: Pane) {
  if (activityBusy.has(p.id)) return
  activityBusy.add(p.id)
  const idle = p.status !== 'working'
  const read = idle
    ? herdr('pane.read', { pane_id: p.id, source: 'visible', format: 'ansi' }, 4000).then((r) => {
        const ansi = String((r.read && r.read.text) || '')
        return { verb: null, screen: null, notice: parseClaudeNotice(ansi.replace(ANSI_RE, '')), suggestion: parseClaudeSuggestion(ansi) }
      })
    : herdr('pane.read', { pane_id: p.id, source: 'detection' }, 4000).then((r) => {
        const text = r.read && r.read.text
        return { verb: parseClaudeActivity(text)?.verb ?? null, screen: parseClaudeScreen(text), notice: parseClaudeNotice(text), suggestion: null }
      })
  read
    .catch(() => ({ verb: null, screen: null, notice: null, suggestion: null }))
    .then(({ verb, screen, notice, suggestion }) => {
      const old = activities.get(p.id)?.screen?.shell
      const sh = screen && screen.shell
      if (sh && old && old.command === sh.command && old.since && (!sh.since || Math.abs(sh.since - old.since) < 5000)) sh.since = old.since
      // Reading finished after the end of the turn: no stale verb on the next turn.
      // When not working, only the status near the input field and the suggestion are kept.
      const working = findPane(p.id)?.status === 'working'
      const old2 = activities.get(p.id)
      activities.set(p.id, working ? { verb, screen, notice, suggestion: null, at: Date.now() } : { verb: null, screen: null, notice, suggestion, at: Date.now() })
      if ((old2?.notice ?? null) !== notice || (old2?.suggestion ?? null) !== (working ? null : suggestion)) setTimeout(poll, 0)
    })
    .finally(() => activityBusy.delete(p.id))
}

// omp status line (see ompScreen.ts): re-read only for an omp on screen.
// While it works, the same reading gives its activity (running step and
// elapsed time), re-read as often as Claude's verb; nothing is kept when idle.
// The start of the turn is kept from one reading to the next (the counter
// does not change the state). It also gives the "!" / "$" command the user
// runs (omp stays idle meanwhile), whose start is kept the same way.
const OMP_STATUS_MS = 3000
type OmpScreenState = { status: OmpStatus | null, activity: OmpActivity | null, shell: ShellRun | null, at: number }
const ompStatuses = new Map<string, OmpScreenState>()
const ompStatusBusy = new Set<string>()
function refreshOmpStatus(p: Pane) {
  if (ompStatusBusy.has(p.id)) return
  ompStatusBusy.add(p.id)
  const prev = ompStatuses.get(p.id)
  herdr('pane.read', { pane_id: p.id, source: 'detection' }, 4000)
    .then((r) => {
      const text = r.read && r.read.text
      const shell = parseOmpShell(text)
      if (shell && prev?.shell && prev.shell.command === shell.command) shell.since = prev.shell.since
      return { status: parseOmpStatus(text), activity: findPane(p.id)?.status === 'working' ? ompActivityOf(parseOmpActivity(text), prev?.activity ?? null) : null, shell }
    }, () => ({ status: prev?.status ?? null, activity: prev?.activity ?? null, shell: prev?.shell ?? null }))
    .then(({ status, activity, shell }) => {
      const old = ompStatuses.get(p.id)
      // Reading finished after the end of the turn: no stale step on the next turn.
      if (findPane(p.id)?.status !== 'working') activity = null
      ompStatuses.set(p.id, { status, activity, shell, at: Date.now() })
      if (JSON.stringify(old?.status ?? null) !== JSON.stringify(status) || JSON.stringify(old?.activity ?? null) !== JSON.stringify(activity)
        || JSON.stringify(old?.shell ?? null) !== JSON.stringify(shell)) setTimeout(poll, 0)
    })
    .finally(() => ompStatusBusy.delete(p.id))
}

// Codex on screen: update notice and weekly-limit warning (see codexStatus.ts).
const CODEX_WEEK_FILE = path.join(DATA_DIR, 'codex-week.json')
let codexWeekWrite: Promise<unknown> = Promise.resolve()
export const codexStatus = createCodexStatus({
  machineOf: (id) => {
    const m = machineOfPane(id)
    if (!m || !m.home) return null
    const exec = m.exec
    return {
      key: m.info().baseKey || m.key, label: m.label, local: m.local, home: m.home, fs: m.fs,
      online: m.local || m.status === 'online',
      exec: exec ? (script, input, timeoutMs) => exec(script, [], { input, timeoutMs }) : null,
    }
  },
  readScreen: id => herdr('pane.read', { pane_id: id, source: 'recent_unwrapped', lines: 300 }, 4000).then(r => String((r.read && r.read.text) || '')),
  rolloutOf: async p => (await transcripts.locate(p))?.file || null,
  runLocal,
  writable: dirWritable,
  onChange: () => poll(),
  log,
  // Latest Codex weekly window per machine, kept across restarts.
  loadWeeks: () => {
    try { return JSON.parse(fs.readFileSync(CODEX_WEEK_FILE, 'utf8')) } catch { return null }
  },
  saveWeeks: (weeks) => {
    const text = JSON.stringify(weeks) + '\n'
    // One write at a time, in order: the last one wins.
    codexWeekWrite = codexWeekWrite
      .then(() => fsp.mkdir(DATA_DIR, { recursive: true }))
      .then(() => fsp.writeFile(CODEX_WEEK_FILE, text, { mode: 0o600 }))
      .catch(() => {})
  },
})
setCodexKnownWeek((key, rolled) => codexStatus.knownWeek(key, state.panes, rolled))

// Agent model: same principle as the preview (background task). Re-read when
// the state changes, and every 5 s (a simple stat if the transcript has
// not changed).
const models = new Map<string, { info: ModelInfo | null, status: string | null, at: number }>()
const modelBusy = new Set<string>()
export function refreshModel(p: Pane) {
  if (modelBusy.has(p.id)) return
  modelBusy.add(p.id)
  currentModel(p)
    .then((info) => {
      const old = models.get(p.id)
      models.set(p.id, { info, status: p.status, at: Date.now() })
      // Change seen outside a poll (choice from the phone): broadcast again.
      if (JSON.stringify(old && old.info) !== JSON.stringify(info)) setTimeout(poll, 0)
    })
    .catch(() => {})
    .finally(() => modelBusy.delete(p.id))
}

// Messages sent from the phone but not yet taken by the agent (it is
// working, or starting): shown as "queued" until they
// appear in its transcript, as in Claude desktop / Codex.
// Kept in data/ to survive a service restart: Claude's own queue only has the
// text ("[Image #1]" for a photo), wherdr's record keeps the photos.
const QUEUED_FILE = path.join(DATA_DIR, 'queued.json')
const queued = new Map<string, QueueEntry[]>(loadQueued(readQueuedFile(), Date.now()))
function readQueuedFile(): unknown {
  try { return JSON.parse(fs.readFileSync(QUEUED_FILE, 'utf8')) } catch { return null }
}
let queuedSaved = JSON.stringify(Object.fromEntries(queued))
function saveQueued() {
  const s = JSON.stringify(Object.fromEntries(queued))
  if (s === queuedSaved) return
  queuedSaved = s
  fsp.writeFile(QUEUED_FILE, s + '\n', { mode: 0o600 }).catch(() => {})
}
// `id`: the app's own id for the bubble it already shows (see app/utils/outbox.ts),
// kept when well-formed and unused, so the bubble keeps its identity.
export function addQueued(paneId: string, text: string, opts: { held?: boolean, busy?: boolean, failed?: boolean, id?: string } = {}): QueuedMessage {
  const list = queued.get(paneId) || []
  const own = opts.id && /^w-[a-z0-9]{1,32}$/.test(opts.id) && !list.some(q => q.id === opts.id) ? opts.id : null
  // Typed during a turn (see isOmpRun).
  const turn = !opts.held && !opts.failed && TURN.has(findPane(paneId)?.status || '')
  const e: QueueEntry = {
    id: own || crypto.randomBytes(4).toString('hex'), text: String(text).slice(0, 4000), at: Date.now(),
    ...(opts.held ? { held: true } : {}), ...(opts.busy ? { busy: true } : {}), ...(opts.failed ? { failed: true } : {}),
    ...(turn ? { turnSeen: true } : {}),
  }
  queued.set(paneId, [...list, e])
  sent.set(paneId, addSent(sent.get(paneId) || [], e.text, e.at))
  return publicEntry(e)
}
// Sent messages with photos or files (see sentHistory.ts): their paths, once
// wherdr's record is gone.
const sent = new Map<string, SentRecord[]>()
// The sent text (paths included) behind one of Claude's records, or null.
const sentText = (paneId: string, entry: { text: string, images?: number, ts?: string | null }, taken: SentRecord[] = []) => {
  const r = findSent(sent.get(paneId) || [], entry, Date.now(), taken)
  if (r) taken.push(r)
  return r ? r.text : null
}
// Claude's queue as the app shows it: an entry with photos gets the message
// wherdr sent (`sent`, paths included) when it is known, so its bubble shows
// the photos and Cancel gives them back, even after the app was reloaded.
export function withSentText(paneId: string, queue: ClaudeQueueEntry[]): ClaudeQueueEntry[] {
  const taken: SentRecord[] = []
  return queue.map((e) => {
    const t = e.images ? sentText(paneId, e, taken) : null
    return t ? { ...e, sent: t } : e
  })
}
export const hasHeld = (paneId: string) => (queued.get(paneId) || []).some(q => q.held && !q.failed)
// Restart or Codex update in progress (restart.ts): it holds the pane's send
// lock for its whole sequence; messages wait as held ones instead.
export const restarting = (paneId: string) => { const r = restarts.get(paneId); return Boolean(r && r.phase !== 'failed') }

// A message to an agent, one at a time per pane. Claude ready or working: the
// checked send of guardedSend.ts (never glued to another writer's message).
// Other agents, commands and agents still starting: agent.prompt.
// Another writer's text taken out of the field and not typed back yet is
// kept as a held message, delivered later like ours.
const GUARD_STATES = new Set(['idle', 'done', 'working'])
export function sendPrompt(p: Pane, text: string): Promise<void> {
  return withPaneLock(p.id, async () => {
    // Re-check after waiting for another writer/restart's lock. The Pane
    // passed by a request or a held-message delivery can already be stale.
    if (findPane(p.id)?.stopped) {
      throw new HerdrError(isSlashCommand(text) ? 'stale' : 'no_input', 'Restart Codex before sending a command.')
    }
    if (p.agent !== 'claude' || !GUARD_STATES.has(p.status || '') || isSlashCommand(text)) return agentPrompt(p.id, text)
    const keep = (texts: string[] | undefined) => {
      for (const t of texts || []) {
        addQueued(p.id, t, { held: true })
        log(`foreign message on ${p.id} kept, typed back later`)
      }
    }
    try {
      const r = await guardedSend({
        box: async () => {
          const r = await herdr('pane.read', { pane_id: p.id, source: 'visible', format: 'ansi' }, 4000)
          return inputBox(String((r.read && r.read.text) || ''))
        },
        type: async (t) => { await herdr('pane.send_input', { pane_id: p.id, text: t }) },
        keys: async (keys) => { await herdr('pane.send_input', { pane_id: p.id, keys }) },
        sleep,
        sentSince: async (since) => {
          const r = await transcripts.chat(p, {})
          return (r.items || []).filter(i => i.role === 'user' && i.ts && Date.parse(i.ts) >= since - 1000).map(i => i.text)
        },
        log: m => log(`send ${p.id}: ${m}`),
      }, text)
      keep(r.unsent)
    } catch (e) {
      keep((e as GuardError).unsent)
      throw e
    }
  })
}
// Field holding someone else's text, or hidden: the message waits.
export const isBusyError = (e: unknown) => e instanceof HerdrError && (e.code === 'input_busy' || e.code === 'no_input')

// Held messages (see queued.ts): typed one at a time, oldest first, once the
// agent rests with its input field on screen. Re-checked on every poll.
const deliverBusy = new Set<string>()
function deliverHeld(p: Pane) {
  const q = nextHeld(queued.get(p.id) || [])
  if (!q || deliverBusy.has(p.id) || !p.agent || p.stopped || !INPUT_STATES.has(p.status || '') || restarting(p.id)) return
  deliverBusy.add(p.id)
  herdr('pane.read', { pane_id: p.id, source: 'detection' }, 4000)
    .then(async (r) => {
      if (!inputVisible(r.read && r.read.text) || !q.held || q.failed) return
      // Removed (Cancel) meanwhile: nothing to send.
      if (!(queued.get(p.id) || []).includes(q)) return
      try { await sendPrompt(p, q.text) }
      catch (e) {
        // Someone's text in the field: still held, until BUSY_TTL_MS.
        if (isBusyError(e)) {
          if ((e as HerdrError).code === 'input_busy' && !q.busy) { q.busy = true; setTimeout(poll, 50) }
          return
        }
        throw e
      }
      q.held = false
      delete q.busy
      q.at = Date.now()
      log(`held message sent on ${p.id}`)
      setTimeout(poll, 50)
    })
    .catch((e) => {
      if (!/not an active|not_ready|blocked/i.test(`${e.code} ${e.message}`)) { q.failed = true; log(`held message ${p.id}: ${e.message}`) }
    })
    .finally(() => deliverBusy.delete(p.id))
}

// Messages taken back after a Stop (see interruptRestore.ts): hidden from the
// conversation, by text and time, until Claude's transcript drops them itself
// (next message written as their sibling). Our "queued" copy goes too.
const takenBack = new Map<string, { text: string, ts: string | null }[]>()
let takenBackSeq = 0
export const takenBackOf = (paneId: string) => ({ hidden: takenBack.get(paneId) || [], seq: takenBackSeq })
export function takeBack(paneId: string, item: { text: string, ts?: string | null, images?: number }): { text: string, lost: number } {
  takenBackSeq++
  takenBack.set(paneId, [...takenBackOf(paneId).hidden, { text: item.text, ts: item.ts || null }].slice(-20))
  const list = queued.get(paneId) || []
  const mine = list.find(q => sameMsg(msgText(q.text), item.text) || sameMsg(item.text, msgText(q.text)))
  const left = list.filter(q => q !== mine)
  if (left.length) queued.set(paneId, left)
  else queued.delete(paneId)
  setTimeout(poll, 50)
  // The original text, photo paths included, goes back into wherdr's field:
  // wherdr's record, usually already gone (the message is in the transcript),
  // otherwise the sent history.
  const text = mine ? mine.text : sentText(paneId, item) || item.text
  return { text, lost: lostPhotos(item.images, text) }
}

// After an interrupt: the prompt Claude put back into its field, taken out of
// it (see interruptRestore.ts). The transcript is looked for again: a brand new
// Claude's first message may be the only thing in it, and only just written.
export function takeBackFromClaude(p: Pane): Promise<ChatItem | null> {
  return takeBackInterrupted({
    screen: async () => String(((await herdr('pane.read', { pane_id: p.id, source: 'visible', format: 'ansi' }, 4000)).read || {}).text || ''),
    keys: async (keys) => { await herdr('pane.send_input', { pane_id: p.id, keys }) },
    chat: async () => (await transcripts.chat(p, { fresh: true })).items || [],
    sleep,
    pending: () => (queued.get(p.id) || []).map(q => q.text),
  }).catch(() => null)
}

// Cancel of a message Claude already took but has not answered yet (always
// the case for the first message of a conversation): it is not in its queue,
// so Cancel does what Stop does, interrupt the turn and take the prompt back.
// null when it is not that turn, or the prompt did not come back.
async function cancelTurn(p: Pane, text: string): Promise<{ text: string, lost: number } | null> {
  if (!unansweredTurn((await transcripts.chat(p, { fresh: true })).items || [], text)) return null
  const r = await interruptAgent({ call: (m, params, t) => herdr(m, params, t), sleep, now: Date.now }, p)
  if (!r.stopped) return null
  const item = await takeBackFromClaude(p)
  if (!item) return null
  log(`taken turn cancelled on ${p.id}`)
  return takeBack(p.id, item)
}

// "Retry" on a failed message: held again, delivered by the next polls.
export function retryQueued(paneId: string, id: string): QueuedMessage {
  const q = (queued.get(paneId) || []).find(x => x.id === id)
  if (!q) throw new HerdrError('not_found', 'Message not found')
  if (!q.failed) throw new HerdrError('busy', 'message already being sent')
  q.failed = false
  q.held = true
  q.at = Date.now()
  delete q.busy
  delete q.readySince
  delete q.turnSeen
  delete q.stuckSince
  delete q.noInput
  setTimeout(poll, 50)
  return publicEntry(q)
}
const reconcileBusy = new Set<string>()
function reconcileQueued(p: Pane) {
  const list = queued.get(p.id)
  if (!list || !list.length || reconcileBusy.has(p.id)) return
  reconcileBusy.add(p.id)
  transcripts.chat(p, {})
    .then((r) => {
      // A held message was not typed yet: only the agent's own transcript can't take it.
      const left = (queued.get(p.id) || []).filter(q => q.held || !queuedDone(q, r.items || [], READY.has(p.status || ''), Date.now(), p.agent))
      if (left.length) queued.set(p.id, left)
      else queued.delete(p.id)
    })
    .catch(() => {})
    .finally(() => reconcileBusy.delete(p.id))
}

// "Cancel" a queued message (bubble button): not sent yet
// (agent starting), we forget it; for a working Claude, we remove it from its
// queue (see unqueue.ts). Returns the text to put back into wherdr's field,
// photo and file paths included, and `lost`: photos whose path is unknown
// (an entry Claude queued itself keeps none).
const unqueueBusy = new Set<string>()
// A held message being typed right now (deliverHeld): Cancel waits for that
// attempt instead of reading it as already sent.
async function deliveryDone(paneId: string) {
  for (let i = 0; i < 60 && deliverBusy.has(paneId); i++) await sleep(100)
}
export async function cancelQueued(paneId: string, text: string, id?: string): Promise<{ text: string, lost?: number }> {
  const p = findPane(paneId)
  if (!p || !p.agent) throw new HerdrError('not_found', 'agent not found')
  let mine = findQueued(queued.get(p.id) || [], text, id)
  if (mine && (mine.held || mine.failed) && deliverBusy.has(p.id)) {
    await deliveryDone(p.id)
    if (!(queued.get(p.id) || []).includes(mine)) mine = undefined
  }
  const drop = () => {
    const left = (queued.get(p.id) || []).filter(q => q !== mine)
    if (left.length) queued.set(p.id, left)
    else queued.delete(p.id)
  }
  // Not typed yet (held) or failed: simply forgotten.
  if (mine && (mine.held || mine.failed) && !deliverBusy.has(p.id)) {
    drop()
    setTimeout(poll, 50)
    return { text: mine.text }
  }
  const pend = pendingPrompts.get(p.id)
  if (pend && !pendingBusy.has(p.id) && sameMsg(msgText(pend.text), msgText(text))) {
    pendingPrompts.delete(p.id)
    drop()
    setTimeout(poll, 50)
    return { text: pend.text }
  }
  if (p.agent !== 'claude') throw new HerdrError('unsupported', 'This agent can’t cancel queued messages')
  if (p.status !== 'working') throw new HerdrError('already_read', 'Already read by the agent')
  if (unqueueBusy.has(p.id)) throw new HerdrError('busy', 'Already cancelling')
  unqueueBusy.add(p.id)
  try {
    const own = [...(queued.get(p.id) || [])]
    // Photos alone have no text to match: wherdr's records of photos alone,
    // in sending order, give back the photos of the entries typed again.
    const ownPhotos = own.filter(q => q !== mine && photosOnly(q.text))
    // Sent history records already given to an entry (see sentHistory.ts):
    // first those of wherdr's own records, this message included.
    const taken: SentRecord[] = (sent.get(p.id) || []).filter(h => h.text === text || own.some(q => q.text === h.text))
    // An entry Claude queued itself (or whose record is gone): its paths
    // from the history, if any.
    const fromHistory = (e: ClaudeQueueEntry) => (e.images ? sentText(p.id, e, taken) : null)
    const r = await withPaneLock(p.id, () => unqueueClaude({
      screen: async () => String(((await herdr('pane.read', { pane_id: p.id, source: 'visible', format: 'ansi' }, 4000)).read || {}).text || ''),
      keys: async (keys) => { await herdr('pane.send_input', { pane_id: p.id, keys }) },
      chat: async () => {
        const r = await transcripts.chat(p, {})
        return { queue: r.queue || [], items: r.items || [] }
      },
      prompt: t => agentPrompt(p.id, t),
      sleep,
      original: e => (!e.text && e.images
        ? ownPhotos.shift()?.text || fromHistory(e)
        : own.find(q => q !== mine && sameMsg(e.text, msgText(q.text)))?.text || fromHistory(e) || e.text),
    }, text)).catch(async (e) => {
      if ((e as HerdrError).code !== 'already_read') throw e
      const back = await cancelTurn(p, text).catch(() => null)
      if (!back) throw e
      return back
    })
    drop()
    if (!('requeued' in r)) return { text: r.text, ...(r.lost ? { lost: r.lost } : {}) }
    log(`queued message cancelled on ${p.id}`)
    // The app only had Claude's record of the message (no paths): the sent
    // history may still know them.
    const known = !mine && r.images > 0 && !hasAttachments(text) ? sentText(p.id, { text: msgText(text), images: r.images }, taken) : null
    const restored = mine ? mine.text : known || text
    const lost = lostPhotos(r.images, restored) + r.lost
    return { text: restored, ...(lost ? { lost } : {}) }
  } catch (e) {
    if ((e as HerdrError).code === 'already_read') drop()
    throw e
  } finally {
    unqueueBusy.delete(p.id)
    setTimeout(poll, 50)
  }
}

// Queued messages of an agent that is ready: the first given at creation (see
// createAgent), or a send refused by Herdr during startup (see prompt.post).
export const pendingPrompts = new Map<string, { text: string, at: number }>()
const PENDING_TTL_MS = 15 * 60 * 1000
const pendingBusy = new Set<string>()
export const READY = new Set(['done', 'idle'])
// The agent is in a turn (working, or waiting for an answer in the middle of one).
const TURN = new Set(['working', 'blocked'])
// Restarts in progress or failed, per pane (see restart.ts).
export const restarts = new Map<string, NonNullable<Pane['restart']> & { at: number, session?: string | null, stopped?: boolean, started?: boolean }>()
const LAST_AGENTS_FILE = path.join(DATA_DIR, 'last-agents.json')
let lastAgentsWrite: Promise<unknown> = Promise.resolve()
export const selfUpdates = createSelfUpdates({
  call: herdr, sleep, now: Date.now,
  chat: p => transcripts.chat(p, { fresh: true }),
  // Only called when a record changed (see agentSelfUpdate.ts).
  save: (records, sync) => {
    const s = JSON.stringify(records) + '\n'
    if (sync) {
      try { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(LAST_AGENTS_FILE, s, { mode: 0o600 }) } catch { /* best effort */ }
      return
    }
    lastAgentsWrite = lastAgentsWrite.then(async () => {
      await fsp.mkdir(DATA_DIR, { recursive: true })
      await fsp.writeFile(LAST_AGENTS_FILE, s, { mode: 0o600 })
    }).catch(() => {})
  },
}, (() => { try { return JSON.parse(fs.readFileSync(LAST_AGENTS_FILE, 'utf8')) } catch { return [] } })())
function flushPending(p: Pane) {
  const pend = pendingPrompts.get(p.id)
  if (!pend || pendingBusy.has(p.id)) return
  if (Date.now() - pend.at > PENDING_TTL_MS) {
    pendingPrompts.delete(p.id)
    log(`initial prompt ${p.id} dropped (timed out)`)
    return
  }
  if (!p.agent || !READY.has(p.status || '')) return
  pendingBusy.add(p.id)
  withPaneLock(p.id, () => agentPrompt(p.id, pend.text))
    .then(() => {
      pendingPrompts.delete(p.id)
      log(`initial prompt ${p.id} sent`)
    })
    .catch((e) => {
      // Not recognized as an agent yet: we will retry on the next round.
      if (!/not an active|not_ready|not_found|blocked/i.test(`${e.code} ${e.message}`)) {
        pendingPrompts.delete(p.id)
        log(`initial prompt ${p.id}: ${e.message}`)
      }
    })
    .finally(() => pendingBusy.delete(p.id))
}

// Moment each agent appeared (so as not to assign it a
// conversation older than itself). Agents already there when the
// service started have no date: we do not know when they were born.
// Kept in data/ to survive service restarts.
const BORN_FILE = path.join(DATA_DIR, 'born.json')
const agentBorn = new Map<string, { agent: string, at: number | null }>()
try {
  for (const [k, v] of Object.entries(JSON.parse(fs.readFileSync(BORN_FILE, 'utf8')))) agentBorn.set(k, v as { agent: string, at: number | null })
} catch { /* no file yet */ }
// Machines whose state we have already seen (agents of the first one have no date).
const seenMachines = new Set<string>()
let bornDirty = false
function saveBorn() {
  if (!bornDirty) return
  bornDirty = false
  fsp.writeFile(BORN_FILE, JSON.stringify(Object.fromEntries(agentBorn)) + '\n').catch(() => {})
}

// ---------------------------------------------------------------- read / unread
// wherdr's own "seen" (each Herdr client keeps its own, and the only means
// on the API side, agent.focus, makes the attached clients' screens jump). Per pane:
// end of the last turn (`readyAt`) and last read (`seenAt`). Ready and unread
// = `done`, read = `idle`, for the whole app (lists, counters, badge).
// Read: conversation open and visible on a device, or marked manually.
const SEEN_FILE = path.join(DATA_DIR, 'seen.json')
const seen = new Map<string, { readyAt: number, seenAt: number }>()
try {
  for (const [k, v] of Object.entries(JSON.parse(fs.readFileSync(SEEN_FILE, 'utf8')))) seen.set(k, v as { readyAt: number, seenAt: number })
} catch { /* first startup */ }
let seenDirty = false
function saveSeen() {
  if (!seenDirty) return
  seenDirty = false
  fsp.writeFile(SEEN_FILE, JSON.stringify(Object.fromEntries(seen)) + '\n').catch(() => {})
}
// Herdr status of a ready agent -> `done` (unread) or `idle` (read), for wherdr.
function applySeen(p: Pane, prevStatus: string | undefined) {
  let e = seen.get(p.id)
  if (!e) {
    // Unknown: we take Herdr's view (done = not seen yet).
    e = p.status === 'done' ? { readyAt: Date.now(), seenAt: 0 } : { readyAt: 0, seenAt: 0 }
    seen.set(p.id, e)
    seenDirty = true
  } else if (prevStatus && !READY.has(prevStatus)) {
    e.readyAt = Date.now() // un tour vient de finir
    seenDirty = true
  }
  if (e.readyAt > e.seenAt && isViewed(p.id)) {
    e.seenAt = Date.now()
    seenDirty = true
  }
  p.status = e.readyAt > e.seenAt ? 'done' : 'idle'
}
// Mark read / unread from the app (context menu).
export function markSeen(paneId: string, read: boolean) {
  const p = findPane(paneId)
  if (!p || !p.agent) throw new HerdrError('bad_pane', 'Pane not found')
  const e = seen.get(paneId) || { readyAt: 0, seenAt: 0 }
  if (read) e.seenAt = Date.now()
  else { e.readyAt = Math.max(e.readyAt, 1); e.seenAt = 0 }
  seen.set(paneId, e)
  seenDirty = true
  saveSeen()
  if (READY.has(p.status || '')) setTimeout(poll, 0)
  return { ok: true }
}

// Foreground command of panes without an agent (title of their card): read
// outside the poll, at most every 3 s per pane; the next poll picks it up.
const COMMAND_TTL_MS = 3000
const commands = new Map<string, { cmd: string, at: number, busy?: boolean }>()
function paneCommand(id: string): string {
  const c = commands.get(id)
  if (!c || (!c.busy && Date.now() - c.at > COMMAND_TTL_MS)) {
    const entry = { cmd: c?.cmd || '', at: Date.now(), busy: true }
    commands.set(id, entry)
    herdr('pane.process_info', { pane_id: id }, 3000)
      .then((r) => { entry.cmd = foregroundCommand(r?.process_info || r) })
      .catch(() => { entry.cmd = '' })
      .finally(() => { entry.busy = false; entry.at = Date.now() })
  }
  return c?.cmd || ''
}

async function enrich(next: HerdrState, snap: Json, machine: string) {
  const firstSnapshot = !seenMachines.has(machine)
  const prevStatus = new Map((mstates.get(machine)?.panes || []).map(p => [p.id, p.status || undefined]))
  const live = new Set(next.panes.map(p => p.id))
  selfUpdates.prune(live, id => machineOf(id) === machine)
  for (const id of commands.keys()) if (machineOf(id) === machine && !live.has(id)) commands.delete(id)
  for (const p of next.panes) {
    const b = agentBorn.get(p.id)
    if (!p.agent) {
      if (b) { agentBorn.delete(p.id); bornDirty = true }
      const cmd = paneCommand(p.id)
      if (cmd) p.command = cmd
      continue
    }
    if (!b || b.agent !== p.agent) {
      agentBorn.set(p.id, { agent: p.agent, at: firstSnapshot ? null : Date.now() })
      bornDirty = true
      // New agent in this pane: its "read" starts from scratch.
      if (b && seen.delete(p.id)) seenDirty = true
    }
    if (READY.has(p.status || '')) applySeen(p, prevStatus.get(p.id))
    const at = agentBorn.get(p.id)!.at
    if (at) p.bornAt = at
  }
  seenMachines.add(machine)
  getMachine(machine)?.transcripts.observe(next.panes)
  const revs = new Map((snap.panes || []).map((p: Json) => [joinId(machine, p.pane_id), p.revision]))
  // Before queues or screen parsing: an exited agent must never receive input.
  // All panes at once: the process read of each Codex pane does not wait for
  // the previous one's.
  const exited = await Promise.all(next.panes.map(p => selfUpdates.observe(p, restarts.has(p.id)).catch(() => false)))
  for (const [i, p] of next.panes.entries()) {
    if (exited[i]) {
      if (queued.has(p.id)) p.queued = queued.get(p.id)!.map(publicEntry)
      continue
    }
    if (pendingPrompts.has(p.id)) { p.pendingPrompt = true; flushPending(p) }
    if (queued.has(p.id)) {
      reconcileQueued(p)
      // Menu, question or panel seen on the previous poll (computed below).
      const before = findPane(p.id)
      // omp ran this "!" / "$" command (seen running on its screen): taken.
      // The screen shows the run from then on; a run cancelled (Stop, Escape) or
      // started before omp's first prompt never reaches the transcript.
      const run = p.agent === 'omp' ? ompStatuses.get(p.id)?.shell : null
      if (run) {
        const left = queued.get(p.id)!.filter(q => q.held || q.failed || !ompRunShown(p.agent, q.text, run))
        if (left.length) queued.set(p.id, left)
        else queued.delete(p.id)
      }
      const list = queued.get(p.id)
      const menu = Boolean(before && (before.menu || before.prompt || before.screen)) || restarting(p.id)
      // omp running the user's "!" command: idle for Herdr, but busy.
      if (list && TURN.has(p.status || '')) for (const q of list) if (!q.held && !q.failed) q.turnSeen = true
      if (list && checkQueue(list, before?.ompShell ? 'working' : p.status, Date.now(), menu)) log(`message not sent on ${p.id}`)
      if (list) deliverHeld(p)
      if (list && list.length) p.queued = list.map(publicEntry)
    }
    const rs = restarts.get(p.id)
    // Relaunch failure then agent relaunched manually, or old failure: nothing left to report.
    if (rs && rs.phase === 'failed' && ((p.agent && rs.stopped) || Date.now() - rs.at > 600000)) restarts.delete(p.id)
    // Relaunched: done as soon as Herdr sees the agent (or after 15 s).
    else if (rs && rs.started && (p.agent || Date.now() - rs.at > 15000)) restarts.delete(p.id)
    else if (rs) {
      p.restart = { phase: rs.phase, agent: rs.agent, ...(rs.error ? { error: rs.error } : {}), ...(rs.update ? { update: rs.update } : {}) }
      // Between the stop and the relaunch (or after a failed relaunch), the pane has
      // no agent: we keep its conversation shown, with the progress.
      if (!p.agent) {
        p.agent = rs.agent
        p.agentSession = rs.session || null
        p.status = 'unknown'
        continue
      }
    }
    if (!p.agent) continue
    // Outside `working`, we also look for a question: some (Codex's folder
    // trust) do not make the agent `blocked` for Herdr.
    if (p.status !== 'working') {
      // Agent without a conversation or born less than 2 min ago (Codex sometimes reports
      // another pane's session, see transcripts.ts): screen watched.
      const young = !p.agentSession || (p.bornAt && Date.now() - p.bornAt < 120000)
      const c = await choicesFor(p, revs.get(p.id), p.status !== 'blocked', Boolean(young))
      if (c.choices) p.prompt = c.choices
      if (c.screen) p.screen = c.screen
      if (c.menu) p.menu = c.menu
    } else {
      choicesCache.delete(p.id)
      askChecks.delete(p.id)
    }
    const pv = previews.get(p.id)
    if (!pv || pv.status !== p.status || (p.status === 'working' && Date.now() - pv.at > 10000)) refreshPreview(p)
    if (pv && pv.text) p.preview = pv.text
    const md = models.get(p.id)
    if (!md || md.status !== p.status || Date.now() - md.at > 5000) refreshModel(p)
    if (md && md.info) p.model = md.info
    // Claude on screen: screen re-read (fast while working, more slowly otherwise, for
    // its status near the input field).
    if (p.agent === 'claude' && isViewed(p.id)) {
      const a = activities.get(p.id)
      const working = p.status === 'working'
      if (!a || Date.now() - a.at >= (working ? ACTIVITY_MS : NOTICE_MS)) refreshActivity(p)
      if (a && a.verb && working) p.activity = a.verb
      if (a && a.screen && working) p.claudeScreen = a.screen
      if (a && a.notice) p.claudeNotice = a.notice
      if (a && a.suggestion && !working && p.status !== 'blocked') p.claudeSuggestion = a.suggestion
    } else activities.delete(p.id)
    if (p.agent === 'omp' && isViewed(p.id)) {
      const o = ompStatuses.get(p.id)
      const working = p.status === 'working'
      // Fast while it works, runs a command or has a message on its way.
      const fast = working || Boolean(o?.shell) || queued.has(p.id)
      if (!o || Date.now() - o.at >= (fast ? ACTIVITY_MS : OMP_STATUS_MS)) refreshOmpStatus(p)
      if (o && o.status) p.ompStatus = o.status
      if (o && o.activity && working) p.ompActivity = o.activity
      if (o && o.shell) p.ompShell = o.shell
    } else ompStatuses.delete(p.id)
    if (p.agent === 'codex' && isViewed(p.id)) {
      const c = codexStatus.statusOf(p)
      if (c) p.codexStatus = c
    } else codexStatus.forget(p.id)
  }
  // Cleanup of vanished panes… of this machine only.
  const alive = (id: string) => machineOf(id) !== machine || next.panes.some(p => p.id === id)
  for (const id of choicesCache.keys()) if (!alive(id)) choicesCache.delete(id)
  for (const id of askChecks.keys()) if (!alive(id)) askChecks.delete(id)
  for (const id of pendingPrompts.keys()) if (!alive(id)) pendingPrompts.delete(id)
  for (const id of queued.keys()) if (!alive(id)) queued.delete(id)
  for (const id of takenBack.keys()) if (!alive(id)) takenBack.delete(id)
  for (const id of restarts.keys()) if (!alive(id)) restarts.delete(id)
  for (const id of agentBorn.keys()) if (!alive(id)) { agentBorn.delete(id); bornDirty = true }
  saveBorn()
  for (const id of seen.keys()) if (!alive(id)) { seen.delete(id); seenDirty = true }
  saveSeen()
  saveQueued()
  for (const id of previews.keys()) if (!alive(id)) { previews.delete(id); transcripts.forget(id) }
  for (const id of models.keys()) if (!alive(id)) { models.delete(id); forgetModel(id) }
  for (const id of activities.keys()) if (!alive(id)) activities.delete(id)
}

// Server-side followers of the merged state (thread limits file…).
const stateListeners = new Set<(s: HerdrState) => void>()
export function onStateChange(fn: (s: HerdrState) => void) { stateListeners.add(fn) }

function broadcastState() {
  for (const fn of stateListeners) {
    try { fn(state) }
    catch (e) { log(`state listener: ${(e as Error).message}`) }
  }
  for (const c of eventClients.values()) {
    try { c.send(stateJson) }
    catch { /* client parti */ }
  }
}

// Union of the machines' states -> broadcast state. With a single machine, it
// is identical to the previous one (no `machines` field, unchanged IDs).
function rebuild() {
  const machines = allMachines()
  for (const k of mstates.keys()) if (!getMachine(k)) mstates.delete(k)
  const loc = mstates.get(LOCAL) || { ok: false, error: 'starting…', workspaces: [], panes: [] }
  const next: HerdrState = { ...loc, workspaces: [...loc.workspaces], tabs: [...(loc.tabs || [])], panes: [...loc.panes] }
  if (multiMachine()) {
    for (const m of machines) {
      if (m.key === LOCAL) continue
      const ms = mstates.get(m.key)
      if (!ms) continue
      next.workspaces.push(...ms.workspaces)
      next.tabs!.push(...(ms.tabs || []))
      next.panes.push(...ms.panes)
    }
    next.machines = machines.map((m): MachineInfo => {
      const ms = mstates.get(m.key)
      const info = m.info()
      // Machine connected but Herdr server silent: "attention".
      if (info.status === 'online' && ms && !ms.ok) return { ...info, status: 'offline', error: ms.error || null, version: ms.version }
      return { ...info, version: ms && ms.version }
    })
  }
  if (!isReady()) next.ready = false
  const json = JSON.stringify(next)
  if (json === stateJson) return
  state = next
  stateJson = json
  broadcastState()
}
onMachinesChange(() => {
  rebuild()
  // Machine just connected: its state without waiting for the next round.
  setTimeout(poll, 0)
})

// "Ready" (see shared/stateReady.ts): once reached, we never go back.
const startedAt = Date.now()
let ready = false
function isReady() {
  ready ||= serverReady({
    machinesListed: machinesListed(),
    localPolled: mstates.has(LOCAL),
    remotes: remoteMachines().map(m => ({ status: m.status, polled: mstates.has(m.key) })),
    elapsedMs: Date.now() - startedAt,
  })
  return ready
}
setTimeout(rebuild, READY_MAX_MS + 100).unref?.()

async function pollMachine(m: Machine) {
  const prev = mstates.get(m.key)
  let next: HerdrState
  try {
    const r = await herdrOn(m.key, 'session.snapshot', {}, 5000)
    const snap = r.snapshot || r
    next = reduceSnapshot(snap, m.key, HERDR_SESSION || 'default')
    await enrich(next, snap, m.key)
    if (m instanceof RemoteMachine) m.reportPoll(true)
  } catch (e) {
    const error = (e as Error).message
    if (m instanceof RemoteMachine) m.reportPoll(false, error)
    // Remote machine: its last state stays shown (grayed out).
    next = m.local || !prev ? { ok: false, error, workspaces: [], panes: [] } : { ...prev, ok: false, error }
  }
  if (!getMachine(m.key)) return // removed in the meantime
  mstates.set(m.key, next)
  if (prev && prev.ok && next.ok) watchTransitions(prev, next)
  rebuild()
}

// One poll at a time per machine; a request during a poll triggers
// another one right after.
const inflight = new Map<string, Promise<void>>()
const again = new Set<string>()
function pollOne(m: Machine): Promise<void> {
  const cur = inflight.get(m.key)
  if (cur) { again.add(m.key); return cur }
  const run = pollMachine(m).catch(() => {}).finally(() => {
    inflight.delete(m.key)
    if (again.delete(m.key)) pollOne(m)
  })
  inflight.set(m.key, run)
  return run
}

// Offline machines: no polling (their connection recovers on its own),
// but their state is republished with the right status.
export async function poll() {
  const ms = allMachines()
  for (const m of ms) {
    if (!m.local && m.status !== 'online' && mstates.get(m.key)?.ok) mstates.set(m.key, { ...mstates.get(m.key)!, ok: false, error: m.error || undefined })
  }
  await Promise.all(ms.filter(m => m.local || m.status === 'online').map(pollOne))
  rebuild()
}

let pollTimer: ReturnType<typeof setTimeout> | null = null
let stopped = false
export function startPolling() {
  stopped = false
  // The loop only waits for the local machine: a slow remote machine is
  // polled at its own pace (pollOne does not restart a poll already in progress).
  const loop = () => {
    const ms = allMachines()
    for (const m of ms) if (m.key !== LOCAL && m.status === 'online' && !inflight.has(m.key)) pollOne(m)
    pollOne(localMachineOf(ms)).finally(() => {
      if (!stopped) pollTimer = setTimeout(loop, POLL_MS)
    })
  }
  loop()
}
const localMachineOf = (ms: Machine[]) => ms.find(m => m.local)!
export function stopPolling() {
  stopped = true
  if (pollTimer) clearTimeout(pollTimer)
  selfUpdates.flush()
}

// ---------------------------------------------------------------- notifications
// We notify when an agent LEAVES `working` for `blocked` (it is waiting for an
// approval) or `done`/`idle` (it has finished). Unless a device has that very
// pane open on screen.
const notifyTimers = new Map<string, ReturnType<typeof setTimeout>>()

function watchTransitions(prev: HerdrState, next: HerdrState) {
  // (states of the same machine)
  const before = new Map(prev.panes.map(p => [p.id, p.status]))
  for (const p of next.panes) {
    const was = before.get(p.id)
    const updated = p.stopped && !prev.panes.find(x => x.id === p.id)?.stopped
    if (!p.agent || (was === p.status && !updated)) continue
    if (updated || (was === 'working' && (p.status === 'blocked' || READY.has(p.status || '')))) {
      clearTimeout(notifyTimers.get(p.id))
      const target = p.status
      notifyTimers.set(p.id, setTimeout(() => {
        notifyTimers.delete(p.id)
        const now = findPane(p.id)
        if (!now) return
        const same = target === 'blocked' ? now.status === 'blocked' : READY.has(now.status || '')
        if (same) notifyPane(now).catch(e => log('notification:', e.message))
      }, NOTIFY_SETTLE_MS))
    } else if (p.status === 'working') {
      clearTimeout(notifyTimers.get(p.id))
      notifyTimers.delete(p.id)
    }
  }
}

const AGENT_LABEL: Record<string, string> = { claude: 'Claude', codex: 'Codex', gemini: 'Gemini', opencode: 'OpenCode', cursor: 'Cursor' }
const agentLabel = (k: string | null) => (k && AGENT_LABEL[k]) || (k ? k[0]!.toUpperCase() + k.slice(1) : 'Agent')
const notificationTitle = (title: string | null) => (title || '').replace(/^[^\p{L}\p{N}]+/u, '').trim()
export function isViewed(paneId: string) {
  for (const t of termSessions) if (t.pane === paneId && t.visible) return true
  for (const v of eventClients.values()) if (v.pane === paneId && v.visible) return true
  return false
}

async function notifyPane(p: Pane) {
  if (isViewed(p.id)) return
  const ws = state.workspaces.find(w => w.id === p.workspace)
  const where = isProjectThread(p)
    ? paneTitle(p, ws?.label)
    : [ws && ws.label, notificationTitle(p.title)].filter(Boolean).join(' · ')
  let body: string
  // Several machines: the title says which one ("laptop · Claude has finished").
  const m = multiMachine() ? machineOfPane(p.id) : null
  const on = m ? `${m.label || (m.local ? 'local' : m.key)} · ` : ''
  if (p.status === 'blocked') {
    const q = p.prompt && p.prompt.question && (p.prompt.question.length > 300 ? `${p.prompt.question.slice(0, 299)}…` : p.prompt.question)
    const opts = p.prompt && p.prompt.options ? p.prompt.options.filter(o => !o.free).slice(0, 4).map(o => o.label).join(' · ') : ''
    body = [q, opts, where].filter(Boolean).join('\n') || p.id
  } else {
    const last = await transcripts.preview(p).catch(() => null)
    body = [last, where].filter(Boolean).join('\n') || p.id
  }
  const { title, titleFr } = agentNotificationTitle(p.status === 'blocked' ? 'blocked' : 'done', `${on}${agentLabel(p.agent)}`)
  const badge = state.panes.filter(x => x.status === 'blocked' || x.status === 'done').length
  const source = machineOfPane(p.id)
  const baseKey = source?.info().baseKey ?? source?.key ?? ''
  const baseSession = getMachine(baseKey)?.session || 'default'
  const session = source?.session || baseSession
  const sent = await pushSend({ title, titleFr, body, tag: `pane-${p.id}`, url: `/#/a/${encodeURIComponent(p.id)}`, badge },
    (scope, sub) => shouldNotify(scope, p) && subWatchesSession(sub, baseKey, session, baseSession))
  log(`notification ${p.id} ${p.status} "${title}" -> ${sent} device(s)`)
}
