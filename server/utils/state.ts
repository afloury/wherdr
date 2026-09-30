// État des agents : `session.snapshot` de Herdr réduit, enrichi (questions à
// l'écran, aperçus, messages en attente) et diffusé à chaque changement.
// Plusieurs machines : chaque machine est sondée à part (une machine lente ou
// en panne ne retarde pas les autres) ; l'état diffusé est leur réunion, avec
// les IDs des machines distantes préfixés (cf. shared/ids.ts).
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import type { Choices, ClaudeScreen, HerdrState, InteractiveMenu, WaitScreen, MachineInfo, ModelInfo, Pane, QueuedMessage } from '../../shared/types'
import { LOCAL, joinId, machineOf } from '../../shared/ids'
import { isProjectThread, paneTitle } from '../../shared/paneTitle'
import { foregroundCommand, reduceSnapshot } from './snapshot'
import { DATA_DIR, HERDR_SESSION, NOTIFY_SETTLE_MS, POLL_MS, log } from './env'
import { HerdrError, herdr, herdrOn, sleep } from './herdr'
import { parseChoices } from './choices'
import { isPermissionQuestion, mergeDetail } from './promptDetail'
import { parseWaitScreen } from './waitScreen'
import { parseMenu, TOP } from '../../shared/menuScreen'
import { parseClaudeActivity } from './activity'
import { parseClaudeNotice, parseClaudeScreen, parseClaudeSuggestion } from './claudeScreen'
import { isUploadLine, queuedDone } from './queued'
import { msgText, unqueueClaude } from './unqueue'
import { type TranscriptPane, sameMsg } from './transcripts'
import { pushSend, subWatchesSession } from './push'
import { shouldNotify } from './notificationPolicy'
import { currentModel, forgetModel, noteScreen } from './modelctl'
import { type Machine, RemoteMachine, allMachines, getMachine, machineOfPane, machinesListed, multiMachine, onMachinesChange, remoteMachines } from './machines'
import { READY_MAX_MS, serverReady } from '../../shared/stateReady'

const fsp = fs.promises

// Transcriptions : celles de la machine du pane (disque local, ou SSH).
function trFor(p: { id: string }) {
  const m = machineOfPane(p.id)
  if (!m) throw new HerdrError('unreachable', 'machine inconnue')
  return m.transcripts
}
export const transcripts = {
  chat: (p: TranscriptPane, o: Parameters<Machine['transcripts']['chat']>[1] = {}) => trFor(p).chat(p, o),
  preview: (p: TranscriptPane) => trFor(p).preview(p),
  image: (p: TranscriptPane, file: string | null, ref: string | null, i: number) => trFor(p).image(p, file, ref, i),
  model: (p: TranscriptPane) => trFor(p).model(p),
  locate: (p: TranscriptPane) => trFor(p).locate(p),
  pendingTool: (p: TranscriptPane) => trFor(p).pendingTool(p),
  forget: (id: string) => machineOfPane(id)?.transcripts.forget(id),
}

export { isUploadLine }

// ---------------------------------------------------------------- clients
// Ce que chaque appareil regarde (pas de notif pour l'agent affiché à l'écran).
export interface EventClient { send: (data: string) => void, pane: string | null, visible: boolean }
export const eventClients = new Map<string, EventClient>()
export interface TermView { pane: string, visible: boolean }
export const termSessions = new Set<TermView>()

// ---------------------------------------------------------------- snapshot
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any

let state: HerdrState = { ok: false, error: 'démarrage…', workspaces: [], panes: [] }
// Dernier état de chaque machine (celui d'une machine hors ligne reste affiché, grisé).
const mstates = new Map<string, HerdrState>()
let stateJson = JSON.stringify(state)
export const getStateJson = () => stateJson
export const getState = () => state
export const findPane = (id: string | null | undefined) => state.panes.find(p => p.id === id)

// Écran visible en ANSI → menu interactif (null s'il n'y en a pas).
export async function readMenu(paneId: string): Promise<InteractiveMenu | null> {
  const r = await herdr('pane.read', { pane_id: paneId, source: 'visible', format: 'ansi' }, 4000)
  return parseMenu(r.read && r.read.text)
}

// Invites bloquantes : relues seulement quand l'écran du pane a changé
// (`revision` de Herdr), et oubliées dès que l'agent n'est plus bloqué.
// L'écran d'attente (légende de touches, cf. waitScreen.ts) est lu en même temps.
// `watch` : la `revision` de Herdr ne bouge pas quand l'écran d'un agent au repos
// change (Codex qui démarre, boîte fermée depuis le terminal) ; on relit alors
// toutes les SCREEN_MS tant qu'une invite est affichée ou que l'agent n'a pas de conversation.
// Demande de permission : la commande ou le fichier demandé vient de
// préférence de la transcription (entière), sinon de l'écran.
const SCREEN_MS = 3000
type OnScreen = { choices: Choices | null, screen: WaitScreen | null, menu: InteractiveMenu | null }
// Écran à relire pendant un moment même sans nouvelle `revision` (commande « / »
// envoyée : un menu interactif peut s'ouvrir), cf. watchScreen().
const screenWatch = new Map<string, number>()
export function watchScreen(paneId: string, ms = 60000) {
  screenWatch.set(paneId, Date.now() + ms)
  choicesCache.delete(paneId)
}
export const choicesCache = new Map<string, { rev: unknown, strict: boolean, at: number } & OnScreen>()
async function choicesFor(p: Pane, rev: unknown, strict: boolean, watch = false): Promise<OnScreen> {
  const c = choicesCache.get(p.id)
  const watched = (screenWatch.get(p.id) || 0) > Date.now()
  if (!watched) screenWatch.delete(p.id)
  const recheck = c && (watch || watched || c.choices || c.screen || c.menu) && Date.now() - c.at >= SCREEN_MS
  if (c && c.rev === rev && c.strict === strict && !recheck) return c
  let out: OnScreen
  try {
    const r = await herdr('pane.read', { pane_id: p.id, source: 'detection' }, 4000)
    const text = r.read && r.read.text
    // Menu interactif de Claude Code (/resume, /model…) : relu en ANSI (les
    // descriptions grises s'y distinguent des entrées). Herdr en croit certains
    // bloquants (/hooks, /mcp) : une vraie question (liste numérotée) garde alors
    // la priorité ; une simple liste à curseur y est lue comme menu.
    const framed = String(text || '').split('\n').some((l: string) => TOP.test(l))
    let choices = parseChoices(text, { strict })
    const menu = framed && (strict || !choices || !parseChoices(text, { strict: true })) ? await readMenu(p.id) : null
    if (menu) choices = null
    out = { choices, screen: menu ? null : parseWaitScreen(text, { choices: Boolean(choices) }), menu }
    noteScreen(p.id, p.agent, text) // Codex : modèle de sa ligne d'état
    if (choices && (choices.detail || isPermissionQuestion(choices.question))) {
      const tr = await transcripts.pendingTool(p).catch(() => null)
      const detail = mergeDetail(tr, choices.detail || null)
      if (detail) choices.detail = detail
    }
  } catch { out = { choices: c ? c.choices : null, screen: c ? c.screen : null, menu: c ? c.menu : null } }
  choicesCache.set(p.id, { rev, strict, at: Date.now(), ...out })
  return out
}

// Aperçu (dernière réponse de l'agent) : rafraîchi en tâche de fond, sans
// retarder la diffusion de l'état.
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

// Verbe animé de Claude (« ✢ Orbiting… ») : lu à l'écran, seulement pour un
// Claude au travail dont la conversation est affichée sur un appareil, au plus
// toutes les ACTIVITY_MS ; oublié dès qu'il ne travaille plus. Seul le verbe est
// diffusé (la durée et les jetons changeraient l'état à chaque seconde).
// La même lecture donne la commande « ! » en cours, sa sortie, et les messages
// partis ou encore en file (cf. claudeScreen.ts) ; le début de la commande est
// gardé d'une lecture à l'autre (le compteur ne fait pas bouger l'état).
const ACTIVITY_MS = 1500
const NOTICE_MS = 5000
// Au repos, l'écran est lu en ANSI pour la suggestion grisée de Claude
// (cf. parseClaudeSuggestion) ; elle n'est gardée que hors travail.
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
      // Lecture finie après la fin du tour : pas de verbe périmé au tour suivant.
      // Hors travail, seuls le statut près du champ de saisie et la suggestion sont gardés.
      const working = findPane(p.id)?.status === 'working'
      const old2 = activities.get(p.id)
      activities.set(p.id, working ? { verb, screen, notice, suggestion: null, at: Date.now() } : { verb: null, screen: null, notice, suggestion, at: Date.now() })
      if ((old2?.notice ?? null) !== notice || (old2?.suggestion ?? null) !== (working ? null : suggestion)) setTimeout(poll, 0)
    })
    .finally(() => activityBusy.delete(p.id))
}

// Modèle de l'agent : même principe que l'aperçu (tâche de fond). Relu quand
// l'état change, et toutes les 5 s (un simple stat si la transcription n'a
// pas bougé).
const models = new Map<string, { info: ModelInfo | null, status: string | null, at: number }>()
const modelBusy = new Set<string>()
export function refreshModel(p: Pane) {
  if (modelBusy.has(p.id)) return
  modelBusy.add(p.id)
  currentModel(p)
    .then((info) => {
      const old = models.get(p.id)
      models.set(p.id, { info, status: p.status, at: Date.now() })
      // Changement vu hors d'un sondage (choix depuis le téléphone) : on rediffuse.
      if (JSON.stringify(old && old.info) !== JSON.stringify(info)) setTimeout(poll, 0)
    })
    .catch(() => {})
    .finally(() => modelBusy.delete(p.id))
}

// Messages envoyés depuis le téléphone mais pas encore pris par l'agent (il
// travaille, ou démarre) : affichés « en attente » jusqu'à ce qu'ils
// apparaissent dans sa transcription, comme dans Claude desktop / Codex.
const queued = new Map<string, Required<QueuedMessage>[]>()
export function addQueued(paneId: string, text: string): Required<QueuedMessage> {
  const e = { id: crypto.randomBytes(4).toString('hex'), text: String(text).slice(0, 4000), at: Date.now() }
  queued.set(paneId, [...(queued.get(paneId) || []), e])
  return e
}
const reconcileBusy = new Set<string>()
function reconcileQueued(p: Pane) {
  const list = queued.get(p.id)
  if (!list || !list.length || reconcileBusy.has(p.id)) return
  reconcileBusy.add(p.id)
  transcripts.chat(p, {})
    .then((r) => {
      const left = (queued.get(p.id) || []).filter(q => !queuedDone(q, r.items || [], READY.has(p.status || ''), Date.now()))
      if (left.length) queued.set(p.id, left)
      else queued.delete(p.id)
    })
    .catch(() => {})
    .finally(() => reconcileBusy.delete(p.id))
}

// « Annuler » un message en attente (bouton de la bulle) : pas encore parti
// (agent qui démarre) on l'oublie ; chez Claude au travail, on le retire de sa
// file (cf. unqueue.ts). Rend le texte à remettre dans le champ de wherdr.
const unqueueBusy = new Set<string>()
export async function cancelQueued(paneId: string, text: string, id?: string): Promise<{ text: string }> {
  const p = findPane(paneId)
  if (!p || !p.agent) throw new HerdrError('not_found', 'agent introuvable')
  const mine = (queued.get(p.id) || []).find(q => (id && q.id === id) || sameMsg(msgText(q.text), msgText(text)))
  const drop = () => {
    const left = (queued.get(p.id) || []).filter(q => q !== mine)
    if (left.length) queued.set(p.id, left)
    else queued.delete(p.id)
  }
  const pend = pendingPrompts.get(p.id)
  if (pend && !pendingBusy.has(p.id) && sameMsg(msgText(pend.text), msgText(text))) {
    pendingPrompts.delete(p.id)
    drop()
    setTimeout(poll, 50)
    return { text: pend.text }
  }
  if (p.agent !== 'claude') throw new HerdrError('unsupported', 'Annulation impossible pour cet agent')
  if (p.status !== 'working') throw new HerdrError('already_read', 'Message déjà lu par l’agent')
  if (unqueueBusy.has(p.id)) throw new HerdrError('busy', 'Annulation déjà en cours')
  unqueueBusy.add(p.id)
  try {
    const own = [...(queued.get(p.id) || [])]
    await unqueueClaude({
      screen: async () => String(((await herdr('pane.read', { pane_id: p.id, source: 'visible', format: 'ansi' }, 4000)).read || {}).text || ''),
      keys: async (keys) => { await herdr('pane.send_input', { pane_id: p.id, keys }) },
      chat: async () => {
        const r = await transcripts.chat(p, {})
        return { queue: r.queue || [], items: r.items || [] }
      },
      prompt: async (t) => { await herdr('agent.prompt', { target: p.id, text: t }) },
      sleep,
      original: t => (own.find(q => q !== mine && sameMsg(t, msgText(q.text))) || { text: t }).text,
    }, text)
    drop()
    log(`message en attente annulé sur ${p.id}`)
    return { text: mine ? mine.text : text }
  } catch (e) {
    if ((e as HerdrError).code === 'already_read') drop()
    throw e
  } finally {
    unqueueBusy.delete(p.id)
    setTimeout(poll, 50)
  }
}

// Premiers messages en attente d'un agent prêt (cf. createAgent).
export const pendingPrompts = new Map<string, { text: string, at: number }>()
const PENDING_TTL_MS = 15 * 60 * 1000
const pendingBusy = new Set<string>()
export const READY = new Set(['done', 'idle'])
// Redémarrages en cours ou échoués, par pane (cf. restart.ts).
export const restarts = new Map<string, NonNullable<Pane['restart']> & { at: number, session?: string | null, stopped?: boolean, started?: boolean }>()
function flushPending(p: Pane) {
  const pend = pendingPrompts.get(p.id)
  if (!pend || pendingBusy.has(p.id)) return
  if (Date.now() - pend.at > PENDING_TTL_MS) {
    pendingPrompts.delete(p.id)
    log(`prompt initial ${p.id} abandonné (délai dépassé)`)
    return
  }
  if (!p.agent || !READY.has(p.status || '')) return
  pendingBusy.add(p.id)
  herdr('agent.prompt', { target: p.id, text: pend.text })
    .then(() => {
      pendingPrompts.delete(p.id)
      log(`prompt initial ${p.id} envoyé`)
    })
    .catch((e) => {
      // Pas encore reconnu comme agent : on réessaiera au prochain tour.
      if (!/not an active|not_ready|not_found|blocked/i.test(`${e.code} ${e.message}`)) {
        pendingPrompts.delete(p.id)
        log(`prompt initial ${p.id} : ${e.message}`)
      }
    })
    .finally(() => pendingBusy.delete(p.id))
}

// Moment où chaque agent est apparu (pour ne pas lui attribuer une
// conversation plus ancienne que lui). Les agents déjà là au démarrage du
// service n'ont pas de date : on ne sait pas quand ils sont nés.
// Gardé dans data/ pour survivre aux redémarrages du service.
const BORN_FILE = path.join(DATA_DIR, 'born.json')
const agentBorn = new Map<string, { agent: string, at: number | null }>()
try {
  for (const [k, v] of Object.entries(JSON.parse(fs.readFileSync(BORN_FILE, 'utf8')))) agentBorn.set(k, v as { agent: string, at: number | null })
} catch { /* pas encore de fichier */ }
// Machines dont on a déjà vu un état (les agents du premier n'ont pas de date).
const seenMachines = new Set<string>()
let bornDirty = false
function saveBorn() {
  if (!bornDirty) return
  bornDirty = false
  fsp.writeFile(BORN_FILE, JSON.stringify(Object.fromEntries(agentBorn)) + '\n').catch(() => {})
}

// ---------------------------------------------------------------- lu / non lu
// « Vu » propre à wherdr (chaque client Herdr tient le sien, et le seul moyen
// côté API, agent.focus, fait sauter l'écran des clients attachés). Par pane :
// fin du dernier tour (`readyAt`) et dernière lecture (`seenAt`). Prêt et non lu
// = `done`, lu = `idle`, pour toute l'app (listes, compteurs, pastille).
// Lu : conversation ouverte et visible sur un appareil, ou marqué à la main.
const SEEN_FILE = path.join(DATA_DIR, 'seen.json')
const seen = new Map<string, { readyAt: number, seenAt: number }>()
try {
  for (const [k, v] of Object.entries(JSON.parse(fs.readFileSync(SEEN_FILE, 'utf8')))) seen.set(k, v as { readyAt: number, seenAt: number })
} catch { /* premier démarrage */ }
let seenDirty = false
function saveSeen() {
  if (!seenDirty) return
  seenDirty = false
  fsp.writeFile(SEEN_FILE, JSON.stringify(Object.fromEntries(seen)) + '\n').catch(() => {})
}
// Statut Herdr d'un agent prêt -> `done` (non lu) ou `idle` (lu), pour wherdr.
function applySeen(p: Pane, prevStatus: string | undefined) {
  let e = seen.get(p.id)
  if (!e) {
    // Inconnu : on reprend l'avis de Herdr (done = pas encore vu).
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
// Marquer lu / non lu depuis l'app (menu contextuel).
export function markSeen(paneId: string, read: boolean) {
  const p = findPane(paneId)
  if (!p || !p.agent) throw new HerdrError('bad_pane', 'pane introuvable')
  const e = seen.get(paneId) || { readyAt: 0, seenAt: 0 }
  if (read) e.seenAt = Date.now()
  else { e.readyAt = Math.max(e.readyAt, 1); e.seenAt = 0 }
  seen.set(paneId, e)
  seenDirty = true
  saveSeen()
  if (READY.has(p.status || '')) setTimeout(poll, 0)
  return { ok: true }
}

// Commande au premier plan des panes sans agent (titre de leur carte) : lue
// hors du sondage, au plus toutes les 3 s par pane ; le sondage suivant la reprend.
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
      // Nouvel agent dans ce pane : son « lu » repart de zéro.
      if (b && seen.delete(p.id)) seenDirty = true
    }
    if (READY.has(p.status || '')) applySeen(p, prevStatus.get(p.id))
    const at = agentBorn.get(p.id)!.at
    if (at) p.bornAt = at
  }
  seenMachines.add(machine)
  getMachine(machine)?.transcripts.observe(next.panes)
  const revs = new Map((snap.panes || []).map((p: Json) => [joinId(machine, p.pane_id), p.revision]))
  for (const p of next.panes) {
    if (pendingPrompts.has(p.id)) { p.pendingPrompt = true; flushPending(p) }
    if (queued.has(p.id)) {
      reconcileQueued(p)
      const list = queued.get(p.id)
      if (list && list.length) p.queued = list.map(({ id, text, at }) => ({ id, text, at }))
    }
    const rs = restarts.get(p.id)
    // Échec à la relance puis agent relancé à la main, ou échec ancien : plus rien à signaler.
    if (rs && rs.phase === 'failed' && ((p.agent && rs.stopped) || Date.now() - rs.at > 600000)) restarts.delete(p.id)
    // Relancé : terminé dès que Herdr voit l'agent (ou au bout de 15 s).
    else if (rs && rs.started && (p.agent || Date.now() - rs.at > 15000)) restarts.delete(p.id)
    else if (rs) {
      p.restart = { phase: rs.phase, agent: rs.agent, ...(rs.error ? { error: rs.error } : {}) }
      // Entre l'arrêt et la relance (ou après une relance ratée), le pane n'a
      // plus d'agent : on garde sa conversation affichée, avec le suivi.
      if (!p.agent) {
        p.agent = rs.agent
        p.agentSession = rs.session || null
        p.status = 'unknown'
        continue
      }
    }
    if (!p.agent) continue
    // Hors `working`, on cherche aussi une question : certaines (confiance du
    // dossier chez Codex) ne font pas passer l'agent en `blocked` pour Herdr.
    if (p.status !== 'working') {
      // Agent sans conversation ou né il y a moins de 2 min (Codex rapporte parfois
      // la session d'un autre pane, cf. transcripts.ts) : écran surveillé.
      const young = !p.agentSession || (p.bornAt && Date.now() - p.bornAt < 120000)
      const c = await choicesFor(p, revs.get(p.id), p.status !== 'blocked', Boolean(young))
      if (c.choices) p.prompt = c.choices
      if (c.screen) p.screen = c.screen
      if (c.menu) p.menu = c.menu
    } else choicesCache.delete(p.id)
    const pv = previews.get(p.id)
    if (!pv || pv.status !== p.status || (p.status === 'working' && Date.now() - pv.at > 10000)) refreshPreview(p)
    if (pv && pv.text) p.preview = pv.text
    const md = models.get(p.id)
    if (!md || md.status !== p.status || Date.now() - md.at > 5000) refreshModel(p)
    if (md && md.info) p.model = md.info
    // Claude affiché : écran relu (vite au travail, plus lentement sinon, pour
    // son statut près du champ de saisie).
    if (p.agent === 'claude' && isViewed(p.id)) {
      const a = activities.get(p.id)
      const working = p.status === 'working'
      if (!a || Date.now() - a.at >= (working ? ACTIVITY_MS : NOTICE_MS)) refreshActivity(p)
      if (a && a.verb && working) p.activity = a.verb
      if (a && a.screen && working) p.claudeScreen = a.screen
      if (a && a.notice) p.claudeNotice = a.notice
      if (a && a.suggestion && !working && p.status !== 'blocked') p.claudeSuggestion = a.suggestion
    } else activities.delete(p.id)
  }
  // Nettoyage des panes disparus… de cette machine seulement.
  const alive = (id: string) => machineOf(id) !== machine || next.panes.some(p => p.id === id)
  for (const id of choicesCache.keys()) if (!alive(id)) choicesCache.delete(id)
  for (const id of pendingPrompts.keys()) if (!alive(id)) pendingPrompts.delete(id)
  for (const id of queued.keys()) if (!alive(id)) queued.delete(id)
  for (const id of restarts.keys()) if (!alive(id)) restarts.delete(id)
  for (const id of agentBorn.keys()) if (!alive(id)) { agentBorn.delete(id); bornDirty = true }
  saveBorn()
  for (const id of seen.keys()) if (!alive(id)) { seen.delete(id); seenDirty = true }
  saveSeen()
  for (const id of previews.keys()) if (!alive(id)) { previews.delete(id); transcripts.forget(id) }
  for (const id of models.keys()) if (!alive(id)) { models.delete(id); forgetModel(id) }
  for (const id of activities.keys()) if (!alive(id)) activities.delete(id)
}

function broadcastState() {
  for (const c of eventClients.values()) {
    try { c.send(stateJson) }
    catch { /* client parti */ }
  }
}

// Réunion des états des machines -> état diffusé. Avec une seule machine, il
// est identique à celui d'avant (pas de champ `machines`, IDs inchangés).
function rebuild() {
  const machines = allMachines()
  for (const k of mstates.keys()) if (!getMachine(k)) mstates.delete(k)
  const loc = mstates.get(LOCAL) || { ok: false, error: 'démarrage…', workspaces: [], panes: [] }
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
      // Machine connectée mais serveur Herdr muet : « attention ».
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
  // Machine tout juste connectée : son état sans attendre le prochain tour.
  setTimeout(poll, 0)
})

// « Prêt » (cf. shared/stateReady.ts) : une fois atteint, on n'y revient plus.
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
    // Machine distante : son dernier état reste affiché (grisé).
    next = m.local || !prev ? { ok: false, error, workspaces: [], panes: [] } : { ...prev, ok: false, error }
  }
  if (!getMachine(m.key)) return // retirée entre-temps
  mstates.set(m.key, next)
  if (prev && prev.ok && next.ok) watchTransitions(prev, next)
  rebuild()
}

// Un sondage à la fois par machine ; une demande pendant un sondage en relance
// un juste après.
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

// Machines hors ligne : pas de sondage (leur connexion se reprend toute seule),
// mais leur état est republié avec le bon statut.
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
  // La boucle n'attend que la machine locale : une machine distante lente se
  // sonde à son rythme (pollOne ne relance pas un sondage déjà en cours).
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
}

// ---------------------------------------------------------------- notifications
// On notifie quand un agent QUITTE `working` pour `blocked` (il attend une
// validation) ou `done`/`idle` (il a fini). Sauf si un appareil a justement ce
// pane ouvert à l'écran.
const notifyTimers = new Map<string, ReturnType<typeof setTimeout>>()

function watchTransitions(prev: HerdrState, next: HerdrState) {
  // (états d'une même machine)
  const before = new Map(prev.panes.map(p => [p.id, p.status]))
  for (const p of next.panes) {
    const was = before.get(p.id)
    if (!p.agent || was === p.status) continue
    if (was === 'working' && (p.status === 'blocked' || READY.has(p.status || ''))) {
      clearTimeout(notifyTimers.get(p.id))
      const target = p.status
      notifyTimers.set(p.id, setTimeout(() => {
        notifyTimers.delete(p.id)
        const now = findPane(p.id)
        if (!now) return
        const same = target === 'blocked' ? now.status === 'blocked' : READY.has(now.status || '')
        if (same) notifyPane(now).catch(e => log('notif:', e.message))
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
  let title: string, titleEn: string, body: string
  // Plusieurs machines : le titre dit laquelle (« laptop · Claude a terminé »).
  const m = multiMachine() ? machineOfPane(p.id) : null
  const on = m ? `${m.label || (m.local ? 'local' : m.key)} · ` : ''
  if (p.status === 'blocked') {
    title = `${on}${agentLabel(p.agent)} attend ta réponse`
    titleEn = `${on}${agentLabel(p.agent)} needs your input`
    const q = p.prompt && p.prompt.question
    const opts = p.prompt && p.prompt.options ? p.prompt.options.slice(0, 4).map(o => o.label).join(' · ') : ''
    body = [q, opts, where].filter(Boolean).join('\n') || p.id
  } else {
    title = `${on}${agentLabel(p.agent)} a terminé`
    titleEn = `${on}${agentLabel(p.agent)} has finished`
    const last = await transcripts.preview(p).catch(() => null)
    body = [last, where].filter(Boolean).join('\n') || p.id
  }
  const badge = state.panes.filter(x => x.status === 'blocked' || x.status === 'done').length
  const source = machineOfPane(p.id)
  const baseKey = source?.info().baseKey ?? source?.key ?? ''
  const baseSession = getMachine(baseKey)?.session || 'default'
  const session = source?.session || baseSession
  const sent = await pushSend({ title, titleEn, body, tag: `pane-${p.id}`, url: `/#/a/${encodeURIComponent(p.id)}`, badge },
    (scope, sub) => shouldNotify(scope, p) && subWatchesSession(sub, baseKey, session, baseSession))
  log(`notif ${p.id} ${p.status} « ${title} » -> ${sent} appareil(s)`)
}
