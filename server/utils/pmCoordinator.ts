// A project coordinator on the server: its token (one per project, scoped to
// it), where its current turn comes from, the `wherdr pm` commands it runs,
// and its role files, written in its own folder on the project's machine.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import fsSync from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import { projectPlace } from '../../shared/pm/places'
import { MAIN, canResume, canRunCoordinator, coordinatorBy, commandList, coordinatorArgs, updateNotice, isCoordinatorProgram, promptAsArg, mainRoleFiles, OWN_ROLE_FILES, parseCommand, roleFiles, citedSpecChange, specChangeRefusal, specChangedText, specDiff, tellTarget, stepDoneEvent, templateDiff, templateEditRefusal, type CoordinatorAgent, type CoordinatorProgram, type CoordinatorView, type Proposal, type ProposalAnswer, type ProposalOutcome, type Turn, PROPOSAL_ANSWERS } from '../../shared/pm/coordinator'
import { initialState, onEvent, planSteps, currentStep } from '../../shared/pm/steps'
import { templateChanges } from '../../shared/pm/templateText'
import { changeSummary, workflowChanges } from '../../shared/pm/workflowChanges'
import { validateTemplate } from '../../shared/pm/workflow'
import { weightOf, weightText, weightsLine } from '../../shared/pm/weight'
import { EXAMPLES } from '../../shared/pm/examples'
import { DEFAULT_AUTOPILOT, LOOK_PER_DAY, USER_ONLY, addRefusal, bump, busyNext, busyQueue, keepsBusy, coordinatorStartRefusal, countFix, limitsLeft, pastLimit, lookAddRefusal, scheduledWake, tellRefusal, today, type Autopilot } from '../../shared/pm/autopilot'
import { ackWakes } from '../../shared/pm/wakes'
import { nextWakeAt, proposalFlow } from '../../shared/pm/flow'
import { incidentView, isOpen, type Incident } from '../../shared/pm/incident'
import { automationLine } from '../../shared/pm/automations'
import type { Template } from '../../shared/pm/workflow'
import { allowedMachines, machineNamed, taskMachine, type Project } from '../../shared/pm/project'
import { projectOf, showIds, shownKey, shownTaskId } from '../../shared/pm/projectKey'
import { taskPlan, waitOf, type Task } from '../../shared/pm/run'
import { HerdrError } from './herdr'
import { PATH_SETUP, homeOf, machineOn, sendAfterDialog, sendFirstMessage, type CoreAdminDeps } from './coreCreate'
import { CREATE_SCRIPT, WRITE_SCRIPT, exec, startTask } from './pmLaunch'
import { actionShell } from './pmActions'
import { SCRIPT } from '../../shared/pm/actions'
import { PR_FIELDS, prMergeAskRefusal, prMergeRefusal, type ContributorPr } from '../../shared/pm/contributorPr'
import { userEvent, userStep } from './pmBoard'
import { ensureVisibility } from './pmVisibility'
import { boardOrder, orderTasks } from '../../shared/pm/boardOrder'
import { removeTask, resumeTask, stopTask } from './pmStop'
import { checkOnGithub } from './pmGhCheck'
import { noteBack } from './pmStall'
import { reviveWorker } from './pmRelease'
import { handFix } from '../../shared/pm/release'
import { DONE_CMD } from '../../shared/pm/advance'
import { READ_LINES, lastWords } from './pmRead'
import { resumeRefusal } from '../../shared/pm/stop'
import { pacedStart, paceLine } from '../../shared/pm/pace'
import { forgetMemory } from './pmMemory'
import { projectEstimates } from './pmPeaks'
import { goesTo, machineLines, paceOf, placeFor, slotsOf } from './pmPlace'
import { STRATEGY_LABELS } from '../../shared/pm/placement'
import { projectPace } from './pmPace'
import { sameFilesText } from '../../shared/pm/files'
import type { CoordinatorRecord, PmStore } from './pmStore'
import { ALFRED, OWN_FILES, alfredFiles, alfredName, isAlfredProgram, startPrompt } from '../../shared/pm/alfred'
import { APP_URL_FILE, DATA_DIR, ENV_APP_URL, HOME } from './env'
import { projectsHome } from '../../bin/lib/userpath.mjs'
import { readV2Projects, type V2Candidate } from './v2Board'
import pkg from '../../package.json'
import { openUi, showUi, uiTargetsList, type UiOpenDeps } from './uiOpen'
import { addAction } from './uiActions'

// The running build's version (shared/v3Version.ts: package version plus commit),
// so the update notice fires between two builds of one version. Outside Nitro
// (unit tests) there is no runtime config: the package version alone.
function wherdrVersion(): string {
  try { return String(useRuntimeConfig().public.version) } catch { return pkg.version }
}

// A project's incidents (all of them with no project named), oldest first.
const projectIncidents = (list: Incident[], tasks: Task[], key: string) =>
  key ? list.filter(i => i.tasks.some(id => tasks.find(t => t.id === id)?.project === key)) : list
async function lastOpenIncident(store: PmStore, key: string) {
  const tasks = await store.tasks()
  const open = projectIncidents(await store.incidents(), tasks, key).filter(i => isOpen(i, tasks)).at(-1)
  return open ? incidentView(open, tasks) : null
}

// alfredHome: Alfred's home folder (DATA_DIR/alfred by default).
type Deps = CoreAdminDeps & { store: PmStore, alfredHome?: string, clients?: UiOpenDeps['clients'] }
const homeOfAlfred = (deps: { alfredHome?: string }) => deps.alfredHome ?? path.join(DATA_DIR, 'alfred')
const sha = (s: string) => createHash('sha256').update(s).digest()

// A new token for the project's coordinator; the one before stops working.
export async function issueToken(store: PmStore, key: string) {
  const token = randomBytes(32).toString('hex')
  // Its settings stay (default agent, autopilot, pending change…); its turn,
  // terminal and agent that ran are the old conversation's.
  const { turn: _turn, terminal: _terminal, ran: _ran, tokenHash: _hash, ...keep } = (await store.coordinator(key)) ?? {}
  await store.saveCoordinator({ ...keep, project: key, tokenHash: sha(token).toString('hex') })
  return token
}

// The project a token belongs to, or null.
export async function scopeOf(store: PmStore, token: unknown) {
  if (typeof token !== 'string' || !/^[0-9a-f]{64}$/.test(token)) return null
  const h = sha(token)
  for (const c of await store.coordinators())
    if (/^[0-9a-f]{64}$/.test(c.tokenHash) && timingSafeEqual(Buffer.from(c.tokenHash, 'hex'), h)) return c.project
  return null
}

// Alfred's token for `wherdr alfred` (server/utils/alfredCli.ts): a new one
// in a file of its home (mode 600) at each start, the one before stops working.
export const ALFRED_TOKEN_FILE = '.alfred-token'
export async function issueAlfredToken(store: PmStore, home: string) {
  const token = randomBytes(32).toString('hex'), file = path.join(home, ALFRED_TOKEN_FILE)
  await fs.writeFile(file, `${token}\n`, { mode: 0o600 })
  await fs.chmod(file, 0o600)
  await store.saveCoordinator({ project: MAIN, tokenHash: '', ...(await store.coordinator(MAIN)), cliHash: sha(token).toString('hex') })
}
export async function alfredTokenOk(store: PmStore, token: unknown) {
  const h = (await store.coordinator(MAIN))?.cliHash
  return typeof token === 'string' && /^[0-9a-f]{64}$/.test(token) && /^[0-9a-f]{64}$/.test(h ?? '') && timingSafeEqual(Buffer.from(h!, 'hex'), sha(token))
}

// Called by whatever delivers a message to the coordinator: the user's
// message from the interface (with its text) or an engine wake.
// look: a look-for-new-work wake, whose turn counts the tasks it adds.
// The user's message is kept whole (a long one too) for the proposal it may lead to.
const SAID_MAX = 8000
export async function noteTurn(store: PmStore, key: string, kind: 'user' | 'wake', said?: string, look = false) {
  const c = await store.coordinator(key)
  if (!c) throw new HerdrError('not_found', 'No coordinator for this project')
  const at = Date.now()
  await store.saveCoordinator({ ...c, turn: { kind, at, ...(kind === 'user' && said ? { said: said.slice(0, SAID_MAX) } : {}), ...(kind === 'wake' && look ? { look: true as const } : {}) }, ...(kind === 'user' ? { userAt: at } : {}) })
}

const TURN_MS = 3_600_000

// The user's message sent from the interface to a terminal: when that
// terminal is a project coordinator, its turn now comes from the user.
export async function userMessageTo(store: PmStore, terminal: string | undefined, text: string) {
  if (!terminal || !(await store.enabled())) return
  const c = (await store.coordinators()).find(x => x.terminal === terminal)
  if (c) await noteTurn(store, c.project, 'user', text)
}

// The branch tasks start from, open their PR to and merge into when a step names none.
const workingBranch = (p?: Project) => p?.base || 'not set: tasks start from the repository\'s current branch, and a step without a branch has none'
const planOf = (t: Template, task: Task, p?: Project) => taskPlan(t, task, p)
const summary = (t: Template | null, task: Task, p?: Project) => {
  const step = t ? currentStep(planOf(t, task, p), task.step ?? initialState()) : undefined
  return { id: p ? shownTaskId([p], task.id) : task.id, title: task.title, type: task.type, state: task.step?.abandoned ? 'abandoned' : task.step?.done ? 'done' : task.stopped ? 'stopped' : task.state, ...(task.stopped ? { stopped: task.stopped } : {}), step: step?.id, holder: step?.holder, yourTurn: task.step?.yourTurn?.badge, tags: task.tags, links: task.links, ...(task.after ? { after: task.after } : {}), ...(task.files ? { files: task.files } : {}), ...(task.sameFiles ? { sameFiles: task.sameFiles } : {}) }
}

// The machine a task runs on, by its name; before its first start, none yet.
const machineOf = (task: Task, p: Project | undefined, known: { key: string, label: string }[]) => {
  const on = task.machine ?? (task.run ? p?.machine : undefined)
  return on !== undefined ? known.find(m => m.key === on)?.label ?? on : 'not started: the engine places it at its start (task start --on picks one)'
}

const unb64 = (v: unknown) => (typeof v === 'string' ? Buffer.from(v, 'base64').toString('utf8') : v)

// POST /api/pm/cli: { argv, input? } with the coordinator's token, or
// { argv64, input64 } from the folder's `wherdr` script. A project's token
// acts on its project only; the main coordinator's on every project.
// The output and a refusal name tasks by their shown key (CMP-9, not CP-9).
type CliBody = { argv?: unknown, input?: unknown, argv64?: unknown, input64?: unknown }
export async function runCommand(deps: Deps, token: unknown, body: CliBody) {
  try { return showIds(await deps.store.projects(), await command(deps, token, body)) }
  catch (e) {
    if (e instanceof Error) e.message = showIds(await deps.store.projects().catch(() => []), e.message)
    throw e
  }
}

async function command(deps: Deps, token: unknown, body: CliBody) {
  const { store } = deps
  const scope = await scopeOf(store, token)
  if (!scope) throw new HerdrError('forbidden', 'Unknown coordinator token')
  const main = scope === MAIN
  if (Array.isArray(body.argv64)) body = { argv: body.argv64.map(unb64), input: unb64(body.input64) }
  const words = Array.isArray(body.argv) ? body.argv.filter(a => typeof a === 'string' && !a.startsWith('--')) : []
  const userOnly = USER_ONLY[words.slice(0, 2).join(' ')] ?? USER_ONLY[words[0] ?? '']
  if (userOnly) throw new HerdrError('refused', userOnly)
  const cmd = parseCommand(body.argv)
  if ('error' in cmd) throw new HerdrError('bad_input', cmd.error)
  const projects = await store.projects()
  // A project named by any of its keys (WD, or WHR before its rename).
  const named = cmd.project ? projectOf(projects, cmd.project)?.key ?? cmd.project : undefined
  if (!main && named && named !== scope) throw new HerdrError('refused', `Your token acts on project ${scope} only`)
  // Another project's task reads as unknown to a project's token.
  const taskOf = async (id: string) => {
    const task = await store.task(id)
    if (!task || (!main && task.project !== scope)) throw new HerdrError('not_found', 'Unknown task')
    return task
  }
  // The command's project: its task's, the one named, or the token's.
  const key = 'task' in cmd ? (await taskOf(cmd.task)).project : named ?? (main ? '' : scope)
  const p = projects.find(x => x.key === key)
  if (key && !p) throw new HerdrError('not_found', 'Unknown project')
  const t = p ? await store.workflow(p.key) : null
  const rec = await store.coordinator(scope)
  // A turn the server saw start over an hour ago is not trusted any more.
  const turn: Turn = rec?.turn && Date.now() - rec.turn.at < TURN_MS ? rec.turn.kind : 'none'
  const by = coordinatorBy(scope)
  const needProject = () => { if (!p) throw new HerdrError('bad_input', `Name the project: --project <KEY> (${projects.map(shownKey).join(', ')})`); return p }
  const needPlan = () => { needProject(); if (!t) throw new HerdrError('not_found', 'The project has no template'); return t }
  // The tasks the limits count: the project's (every task for the main coordinator with no project named).
  const mineOf = async () => (await store.tasks()).filter(x => (main && !key) || x.project === key)
  // The autopilot that holds the command: the project's own, also for Alfred (which has none).
  const pilotRec = main ? (key ? await store.coordinator(key) : null) : rec, pilot = pilotRec?.autopilot

  // Alfred has no autopilot: it starts or adds tasks in the user's turns only.
  if (main && turn !== 'user' && (cmd.name === 'task start' || cmd.name === 'task add')) throw new HerdrError('refused', `Alfred runs ${cmd.name} only on a request from the user, sent from wherdr: each project's coordinator runs its own autopilot`)

  switch (cmd.name) {
    case 'help': return { commands: commandList(t) }
    case 'ui targets': return uiTargetsList()
    case 'ui action': return addAction(store, { scope, turn, by: main ? ALFRED : `${shownKey(p ?? { key: scope })} coordinator`, kind: cmd.action, task: await taskOf(cmd.task) })
    case 'ui show': return showUi({ ...deps, clients: deps.clients ?? (() => []) }, { scope, turn, by: main ? ALFRED : `${shownKey(p ?? { key: scope })} coordinator`, ...(cmd.what === 'file' ? { what: cmd.what, path: cmd.path } : { what: cmd.what, task: await taskOf(cmd.task) }) })
    case 'ui open': return openUi({ ...deps, clients: deps.clients ?? (() => []) }, { scope, main, raw: cmd.link, turn, by: main ? ALFRED : `${scope} coordinator` })
    case 'list': {
      const ts = new Map(await Promise.all(projects.map(async x => [x.key, x ? await store.workflow(x.key) : null] as const)))
      // Archived tasks only with --archived, newest archived first.
      const tasks = (await store.tasks()).filter(x => (!key || x.project === key) && !!x.archived === !!cmd.archived)
      return { tasks: (cmd.archived ? tasks.sort((a, b) => b.archived! - a.archived!) : boardOrder(tasks)).map(x => summary(ts.get(x.project) ?? null, x, projects.find(y => y.key === x.project))) }
    }
    case 'show': { const task = await taskOf(cmd.task); return { task: { ...summary(t, task, p), weight: weightText(weightOf(t, task)), machine: machineOf(task, p, deps.machines()), description: task.description, log: task.log ?? [] }, plan: t ? planOf(t, task, p) : [] } }
    case 'plan': return { template: t && { id: t.id, version: t.version }, workingBranch: workingBranch(p), plans: Object.fromEntries(Object.keys(needPlan().taskTypes).map(type => [type, planSteps(t!, { type }, p?.base)])) }
    case 'template show': return {
      template: needPlan(),
      ...(main ? {} : rec?.proposal ? { proposal: 'waiting for the user in wherdr', diff: rec.proposal.diff } : answersOf(rec).length ? { lastProposal: answersOf(rec).at(-1)!.outcome } : {}),
    }
    case 'template edit': {
      if (main) throw new HerdrError('refused', 'template edit is the project coordinator\'s or the user\'s: add a task or tell the user')
      let next: Template
      try { next = JSON.parse(String(body.input ?? '')) as Template } catch { throw new HerdrError('bad_input', 'The new template is not valid JSON') }
      // Always the project's own workflow, whatever id the JSON names.
      if (t && next && typeof next === 'object') next = { ...next, id: t.id }
      editRefusal(t, next, turn, key)
      const errors = validateTemplate(next)
      if (errors.length) throw new HerdrError('bad_input', errors.map(e => `${e.path}: ${e.message}`).join('; '))
      // The user accepts or refuses it in the interface; nothing is saved yet.
      // by: who proposed it; said, saidAt: the user's message it follows.
      const changes = workflowChanges(t, next)
      const proposal = { template: next, diff: templateDiff(t, next), at: Date.now(), base: t!.version ?? 1, by: main ? 'main' : scope, changes, ...(rec?.turn?.said ? { said: rec.turn.said, saidAt: rec.turn.at } : {}) }
      // One still waiting is replaced: its card says so.
      await store.saveCoordinator({ ...withAnswer(rec!, rec?.proposal && answerOf(rec.proposal, 'replaced', rec.proposal.by === 'main' ? ALFRED : coordinatorBy(scope))), proposal })
      return { proposed: true, changes: templateChanges(t, next), diff: proposal.diff, next: `The user accepts or refuses this diff in ${projectPlace(key, 'workflow', true)}; template show tells you what they chose` }
    }
    case 'task tag': {
      const task = await taskOf(cmd.task)
      if ((task.tags ?? []).includes(cmd.text)) return { task }
      return { task: await store.logTask({ ...task, tags: [...(task.tags ?? []), cmd.text].slice(-20) }, by, `tag ${cmd.text}`) }
    }
    case 'task link': {
      const task = await taskOf(cmd.task)
      const links = [...(task.links ?? []).filter(l => l.url !== cmd.url), { label: cmd.label, url: cmd.url }].slice(-20)
      return { task: await store.logTask({ ...task, links }, by, `link ${cmd.label} ${cmd.url}`) }
    }
    case 'step done': {
      const task = await taskOf(cmd.task)
      const plan = planOf(needPlan(), task, p)
      const state = task.step ?? initialState()
      const ev = stepDoneEvent(currentStep(plan, state), cmd, turn)
      if ('refused' in ev) throw new HerdrError('refused', ev.refused)
      const step = currentStep(plan, state)!.id
      // The user's words: the same path as the step's button (runs its check).
      // The log keeps the user's own message (the turn's), not the coordinator's quote.
      if (ev.kind === 'user') return { task: await store.logTask(await userStep(deps, task.id), by, `${step}: done on the user's message "${(rec?.turn?.said ?? '').slice(0, 500)}"`) }
      const r = onEvent(plan, state, ev, Date.now())
      if (r.refused) throw new HerdrError('refused', r.refused)
      return { task: await store.logTask({ ...task, step: r.state }, by, `${step}: done`) }
    }
    case 'ack': {
      const r = ackWakes(await store.wakes(), scope, cmd.wakes, Date.now())
      if (r.unknown.length) throw new HerdrError('not_found', `No wake ${r.unknown.join(', ')} was delivered to you`)
      await store.saveWakes(r.changed)
      return { acked: cmd.wakes }
    }
    case 'autopilot show': {
      if (main && !key) return { autopilots: Object.fromEntries(await Promise.all(projects.map(async x => [x.key, { on: !!(await store.coordinator(x.key))?.autopilot?.on }]))), note: 'You have no autopilot: each project\'s coordinator runs its own. Add --project <KEY> for one project\'s' }
      const ap = pilot ?? DEFAULT_AUTOPILOT
      const mine = await mineOf()
      const now = Date.now()
      const line = async (k: string) => { const pace = await projectPace(store, k, undefined, now, true); return pace ? paceLine(pace, now) : 'unknown: the project has no template or no worker program' }
      const lines = (x: Project) => machineLines(deps, x).catch(() => ['machines unknown'])
      // Keep the board busy: on or off, and what the engine starts next (or why nothing).
      const busy = async (x: Project) => {
        const xap = (await store.coordinator(x.key))?.autopilot, tasks = (await store.tasks()).filter(y => y.project === x.key)
        const head = busyQueue(tasks)[0], pace = head ? await paceOf(store, x, head, now).catch(() => undefined) : undefined
        const n = busyNext(xap, tasks, await store.runs(), now, { pace: pace?.verdict, holds: await slotsOf(store, [x]) })
        return { on: keepsBusy(xap), next: 'task' in n ? `${n.task.id} (${n.task.title}), once a machine has room` : n.why }
      }
      const weights = async (x: Project, tpl: Template | null) => ({ estimates: weightsLine(await projectEstimates(store, x.key)), types: Object.fromEntries(Object.keys(tpl?.taskTypes ?? {}).map(type => [type, weightText(weightOf(tpl, { type }))])) })
      return {
        autopilot: ap, lookForWork: !!ap.lookForWork, lastOpenIncident: await lastOpenIncident(store, key),
        workingBranch: key ? workingBranch(p) : Object.fromEntries(projects.map(x => [x.key, workingBranch(x)])),
        placement: key ? STRATEGY_LABELS[p!.placement ?? 'strongest'] : Object.fromEntries(projects.map(x => [x.key, STRATEGY_LABELS[x.placement ?? 'strongest']])),
        pacing: key ? await line(key) : Object.fromEntries(await Promise.all(projects.map(async x => [x.key, await line(x.key)]))),
        machines: key ? await lines(p!) : Object.fromEntries(await Promise.all(projects.map(async x => [x.key, await lines(x)]))),
        keepBusy: key ? await busy(p!) : Object.fromEntries(await Promise.all(projects.map(async x => [x.key, await busy(x)]))),
        weights: key ? await weights(p!, t) : Object.fromEntries(await Promise.all(projects.map(async x => [x.key, weights(x, await store.workflow(x.key))]))),
        // Wakes not sent, newest first: what and why.
        skippedWakes: [...(pilotRec?.skips ?? [])].reverse().map(x => ({ at: new Date(x.at).toISOString(), what: x.what, why: x.why })),
        today: { ...limitsLeft(ap, mine, await store.runs(), now, await slotsOf(store, p ? [p] : projects)), skippedWakes: today(pilotRec?.skipped, now), ...(ap.lookForWork ? { newWorkAdded: today(pilotRec?.lookAdded, now), newWorkPerDay: ap.lookPerDay ?? LOOK_PER_DAY } : {}) },
        note: 'Only the user changes these, in wherdr. keepBusy: with it on, the engine itself starts the next to-do task in board order (oldest first) while a machine has room, within the limits, hours and pace; next says which, or why none. With nothing to do and lookForWork off, scheduled wakes are skipped, and so are they while nothing you could act on changed since your last wake (no task startable now, no new block, no answer); a health check repeating the last one\'s lines (within 12 h), a question you already answered with tell, and an engine wake for a block that is only an offline or paused machine (the incident covers it; the engine resumes the task itself and wakes you if that fails) are skipped too. skippedWakes lists the last ones, what and why; today.skippedWakes counts today\'s skipped scheduled wakes. Pacing holds automatic work only (wakes, tasks added in wakes, automations): scheduled wakes are skipped and such starts refused while it waits; the user\'s own starts never are. The engine places each start on one of the project\'s allowed machines by its placement strategy (Heavy to the strongest: heavy work on the strongest, light and standard work at home when it fits; Balance the load: each task on the machine with most room; Home first: home until it is full; --on picks one); automatic starts wait while no machine has room (memory, cores, its cap of agents, all projects together) and start by themselves once one has. perDay, atOnce and hours hold automatic work only: a start the user asks for goes past them, and still counts in them. perDay null: no daily limit; atOnce null is Auto: as many tasks as the machines take (both the defaults of a new project). Whatever the counts, pacing and machine room still hold automatic work. machines: each allowed machine, its agents at work by weight, its available hours (automatic starts skip it outside them, heavy work in its last 2 hours) and the heaviest weight it takes now (or why none: offline, away, full…); weights: what placement counts per weight (learned from the measured peaks of the project after 3 runs of that weight, else the default), and the weight each task type gets. lastOpenIncident: the last time agents were gone and why, from facts (wherdr pm incidents lists them all); null when none is open',
      }
    }
    case 'incidents': {
      const since = cmd.since ?? Date.now() - 7 * 86_400_000, tasks = await store.tasks()
      const list = projectIncidents(await store.incidents(), tasks, key).filter(i => i.at >= since).reverse()
      return { incidents: list.map(i => incidentView(i, tasks)), note: 'The cause comes from facts the engine read (herdr-core\'s machines and terminals, the account\'s limit data); unknown means they did not decide. Tell the user this cause, never a guess' }
    }
    case 'automation list': return { automations: (await store.automations(needProject().key)).automations.map(automationLine), note: 'Only the user adds or changes automations, in wherdr' }
    case 'automation show': {
      const a = (await store.automations(needProject().key)).automations.find(x => x.id === cmd.id)
      if (!a) throw new HerdrError('not_found', 'Unknown automation')
      return { automation: a }
    }
    case 'tell': {
      const task = await taskOf(cmd.task)
      const specWhy = cmd.spec ? specChangeRefusal(turn) : undefined
      if (specWhy) throw new HerdrError('refused', specWhy)
      // --spec: the message is also a spec note, for the reviewer's next round.
      const noted = (x: Task) => (cmd.spec ? store.logTask({ ...x, specNotes: [...(x.specNotes ?? []), { at: Date.now(), by, text: cmd.text }] }, by, `spec change: ${cmd.text.slice(0, 300)}`) : x)
      const holder = t && !task.step?.done ? currentStep(planOf(t, task, p), task.step ?? initialState())?.holder : undefined
      const { role, run, released } = tellTarget(await store.runs(), task.id, holder, cmd.to, !!cmd.fix)
      // A failed step action handed over with a fix: the worker reports it done, then the engine tries it again.
      const fixesAction = !!(cmd.fix && t && handFix(planOf(t, task, p), task.step, cmd.fix, Date.now()))
      const said = `From the ${main ? 'main' : 'project'} coordinator: ${cmd.text}${fixesAction ? `\n\nWhen done: ${DONE_CMD}` : ''}`
      const wake = turn !== 'user', fix = cmd.fix && { autopilot: rec?.autopilot, main }
      // A wake's fix counts against the step's; the log keeps its kind and reason.
      const fixed = (x: Task) => (cmd.fix && wake ? { ...x, fixes: countFix(task) } : x)
      const fixNote = cmd.fix ? ` (fix ${cmd.fix}: ${cmd.reason})` : ''
      // A failed step action handed over with a fix: off Your turn while the agent fixes it, then tried again.
      const handed = async (x: Task) => {
        const step = cmd.fix && t ? handFix(planOf(t, x, p), x.step, cmd.fix, Date.now()) : undefined
        return step ? store.logTask({ ...x, step }, by, `${currentStep(planOf(t!, x, p), step)?.id ?? 'step'}: the agent is fixing it, then it is tried again`) : x
      }
      if (released) {
        const why = tellRefusal(task, wake, fix)
        if (why) throw new HerdrError('refused', why)
        const started = await reviveWorker(deps, task.id, cmd.fix ? `a fix of the coordinator: ${cmd.reason}` : 'a message of the coordinator', said)
        if (started?.state !== 'working') throw new HerdrError('refused', 'The task\'s worker could not start again now (short on memory?): try again later')
        const told = await noted(await handed(await store.logTask(fixed(started), by, `told the worker, started again${fixNote}: ${cmd.text.slice(0, 300)}`)))
        return { task: t ? await noteBack(store, told, planOf(t, told, p), by, `the ${by} told the worker`) : told, sentTo: 'worker (started again with your message)' }
      }
      if (!run?.terminal) throw new HerdrError('not_found', `The task's ${role} is not running${cmd.to ? '' : ` (--to ${role === 'worker' ? 'reviewer' : 'worker'} picks the other agent)`}`)
      // What the agent waits for now, from its terminal: a permission prompt is never typed into.
      const live = waitOf(await deps.call<Parameters<typeof waitOf>[0]>('terminal.get', { terminal: run.terminal }, 3000).catch(() => null))
      const why = tellRefusal({ ...task, state: live ? 'waiting' : task.state, waitKind: live ?? task.waitKind }, wake, fix)
      if (why) throw new HerdrError('refused', why)
      await deps.call('terminal.send', { terminal: run.terminal, text: said }, 30000)
      const saved = await noted(await handed(await store.logTask(fixed(task.state === 'waiting' && task.waitKind === 'question' ? { ...task, state: 'working', waiting: undefined, waitKind: undefined, answered: Date.now() } : task), by, `told the ${role}${fixNote}: ${cmd.text.slice(0, 300)}`)))
      return { task: t ? await noteBack(store, saved, planOf(t, saved, p), by, `the ${by} told the ${role}`) : saved, sentTo: role }
    }
    case 'read': {
      const task = await taskOf(cmd.task)
      // The agent tell reaches (or the one asked), its latest run, ended or not.
      const runs = await store.runs()
      const holder = t && !task.step?.done ? currentStep(planOf(t, task, p), task.step ?? initialState())?.holder : undefined
      const { role } = tellTarget(runs, task.id, holder, cmd.to)
      const run = runs.filter(r => r.task === task.id && r.role === role && r.terminal).sort((a, b) => b.startedAt - a.startedAt)[0]
      if (!run) throw new HerdrError('not_found', `The task has no ${role} yet`)
      const said = await lastWords(deps, run.terminal!, cmd.lines ?? READ_LINES)
      if (!said) throw new HerdrError('unreachable', `Nothing to read from the task's ${run.role}: its conversation and its terminal are out of reach`)
      return { task: p ? shownTaskId([p], task.id) : task.id, agent: run.role, running: run.state !== 'ended', ...(task.state === 'waiting' && task.waitKind ? { waits: task.waitKind } : {}), ...said }
    }
    case 'task start': {
      const task = await taskOf(cmd.task)
      // --on: a machine the project allows, for a task never started (a started one stays on its own).
      const named = cmd.on === undefined ? undefined : machineNamed(p!, deps.machines(), cmd.on)
      const placed = named && ('refused' in named ? named : taskMachine(task, p!, named.machine))
      if (placed && 'refused' in placed) throw new HerdrError('refused', placed.refused)
      const mine = await mineOf()
      const wake = turn !== 'user', who = { who: 'coordinator' as const, wake }, now = Date.now()
      const pace = pacedStart(task, wake ? 'wake' : 'user') ? await paceOf(store, p!, task, now) : undefined
      const runs = await store.runs(), holds = await slotsOf(store, p ? [p] : projects)
      const why = (task.stopped ? resumeRefusal(task, 'continue', who, undefined) : undefined)
        ?? coordinatorStartRefusal(pilot, task, mine, runs, now, wake, { pace: pace?.verdict, holds })
      if (why) throw new HerdrError('refused', why)
      // The user's start goes past the autopilot's limits, and says so.
      const past = wake ? undefined : pastLimit(pilot, mine, runs, now, holds)
      // No room on any allowed machine: a wake's start waits for it (the engine starts it then); the user's goes, with a word.
      const { on, short } = goesTo(await placeFor(deps, task, { asked: placed?.machine, waits: pace?.waits }))
      // A failed task a wake starts again goes back to do, where the engine starts held tasks.
      if (short && wake && !task.stopped) return { task: await store.logTask({ ...task, state: 'todo', waiting: undefined, waitKind: undefined, autopilot: true, held: short }, by, short), held: `${short}. It starts by itself once there is room` }
      // Started in a wake: the autopilot's own task, which it may stop in a wake.
      if (wake && !task.autopilot) await store.saveTask({ ...(await store.task(task.id) ?? task), autopilot: true })
      const said = { ...(short ? { memory: `${short}: started anyway, as the user asked` } : {}), ...(past ? { note: `started; ${past}` } : {}) }
      if (task.stopped) return { task: await resumeTask(deps, task.id, 'continue', who, by), ...said }
      if (on !== undefined) forgetMemory(on)
      const started = await startTask(deps, task.id, { by, ...(on !== undefined ? { on } : {}) })
      if (started.sameFiles) return { task: started, held: `${sameFilesText(started.sameFiles)}: it starts by itself once that task no longer touches them` }
      return { task: await store.logTask(started, by, started.state === 'working' ? 'started the task' : `could not start the task: ${started.waiting ?? ''}`), ...said }
    }
    case 'task edit': case 'task note': {
      const why = specChangeRefusal(turn)
      if (why) throw new HerdrError('refused', why)
      const task = await taskOf(cmd.task), at = Date.now()
      const next = cmd.name === 'task edit'
        ? { ...task, title: cmd.title ?? task.title, description: cmd.description ?? task.description }
        : { ...task, specNotes: [...(task.specNotes ?? []), { at, by, text: cmd.text }] }
      const saved = cmd.name === 'task edit'
        ? await store.logTask(next, by, `edited the spec (${cmd.reason}):\n${specDiff(task, next)}`)
        : await store.logTask(next, by, `spec change: ${cmd.text.slice(0, 300)}`)
      // Its running agents read it at once; the next ones get it in their instructions.
      const what = cmd.name === 'task note' ? cmd.text
        : [cmd.title !== undefined && `its title is now "${cmd.title}".`, cmd.description !== undefined && `its description is now:\n\n${cmd.description}`].filter(Boolean).join('\n')
      const told: string[] = []
      for (const r of (await store.runs()).filter(r => r.task === task.id && r.state !== 'ended' && r.terminal)) {
        await deps.call('terminal.send', { terminal: r.terminal, text: showIds(projects, specChangedText(what)) }, 30000).then(() => told.push(r.role), () => {})
      }
      return { task: saved, told }
    }
    case 'task check': return checkOnGithub(deps, (await taskOf(cmd.task)).id, by)
    case 'task stop': {
      const task = await taskOf(cmd.task)
      return { task: await stopTask(deps, task.id, { who: 'coordinator', wake: turn !== 'user' }, cmd.reason, by) }
    }
    case 'task remove': {
      const task = await taskOf(cmd.task)
      return removeTask(deps, task.id, { who: 'coordinator', wake: turn !== 'user' }, cmd.reason, by)
    }
    case 'task order': {
      if (turn !== 'user' && !pilot?.on) throw new HerdrError('refused', 'In a wake, the board is ordered only with the autopilot on')
      const picked = await Promise.all(cmd.tasks.map(taskOf))
      const mine = (await store.tasks()).filter(x => x.project === key)
      const r = orderTasks(mine, picked.map(x => x.id))
      if ('refused' in r) throw new HerdrError('refused', r.refused)
      // Read again: the engine may have moved it since.
      for (const x of picked) await store.saveTask({ ...(await store.task(x.id)) ?? x, order: r.order[x.id] })
      await store.logProject(key, { by, text: `put first on the board, in this order: ${cmd.tasks.join(', ')}`, ...(rec?.turn?.said ? { said: rec.turn.said } : {}) })
      return { ordered: cmd.tasks, tasks: boardOrder(await store.tasks()).filter(x => x.project === key && !x.step?.done).map(x => x.id) }
    }
    case 'task add': {
      const look = turn === 'wake' && !!rec?.turn?.look
      const why = addRefusal(pilot, turn !== 'user') ?? (look ? lookAddRefusal(pilot, today(rec?.lookAdded, Date.now())) : undefined)
      if (why) throw new HerdrError('refused', why)
      if (!Object.hasOwn(needPlan().taskTypes, cmd.type)) throw new HerdrError('bad_input', `No task type "${cmd.type}": ${Object.keys(t!.taskTypes).join(', ')}`)
      // Added in the user's turn: their request, never held by the pace.
      const added = await store.addTask({ project: key, title: cmd.title, type: cmd.type, description: cmd.description ?? '', after: cmd.after ?? '', files: cmd.files ?? [], ...(cmd.weight ? { weight: cmd.weight } : {}), origin: turn === 'user' ? 'user' : 'coordinator', addedBy: scope })
      const task = turn !== 'user' ? { ...added, autopilot: true as const } : added
      if (look) await store.saveCoordinator({ ...rec!, lookAdded: bump(rec!.lookAdded, Date.now()) })
      return { task: await store.logTask(task, by, `added the task${cmd.after ? `, after ${cmd.after}` : ''}`) }
    }
    case 'pr merge': {
      if (main) throw new HerdrError('refused', 'pr merge is the project coordinator\'s')
      const proj = needProject()
      if (proj.git === false) throw new HerdrError('refused', 'The project has no git repository')
      const base = { guards: t?.guards, turn, userSaid: cmd.userSaid }
      // No GitHub call in a wake or with the guard off.
      const ask = prMergeAskRefusal(base)
      if (ask) throw new HerdrError('refused', ask)
      const taskLinks = (await store.tasks()).flatMap(x => [...(x.links ?? []).map(l => l.url), ...(x.branch ? [x.branch] : [])])
      const sh = actionShell(deps, machineOn(deps, proj.machine).on)
      const view = await sh(`cd "$1" || exit 1; gh pr view "$2" --json ${PR_FIELDS}`, [proj.path, String(cmd.pr)])
      let pr: ContributorPr | null = null
      if (view.code === 0) try { pr = JSON.parse(view.out.trim().split('\n').find(l => l.startsWith('{')) ?? '') as ContributorPr } catch { throw new HerdrError('failed', 'Unreadable PR details') }
      else if (!/could not resolve|not found/i.test(view.out)) throw new HerdrError('failed', `gh pr view: ${view.out.trim().split('\n').pop() ?? ''}`)
      const why = prMergeRefusal({ ...base, pr, taskLinks })
      if (why) throw new HerdrError('refused', why)
      const m = await sh(SCRIPT.merge, [proj.path, pr!.url, pr!.headRefOid, cmd.method ?? ''])
      if (m.code !== 0) throw new HerdrError('failed', `gh pr merge: ${m.out.trim().split('\n').pop() ?? ''}`)
      await store.logProject(proj.key, { by, pr: pr!.number, text: `merged contributor PR #${pr!.number} into ${pr!.baseRefName}${cmd.method ? ` (${cmd.method})` : ''} on the user's yes: "${cmd.userSaid}"`, ...(rec?.turn?.said ? { said: rec.turn.said } : {}) })
      return { merged: pr!.url, into: pr!.baseRefName }
    }
    case 'report back': case 'report close': {
      const task = await taskOf(cmd.task)
      if (!task.report) throw new HerdrError('refused', 'No open report on this task: the user withdrew it, or it is closed')
      if (cmd.name === 'report back') return { task: await userEvent(store, task.id, { kind: 'back', note: cmd.text }, by) }
      return { task: await store.logTask({ ...task, report: undefined }, by, `closed the reported problem: ${cmd.text.slice(0, 300)}`) }
    }
    case 'task decide': {
      const task = await taskOf(cmd.task), now = Date.now()
      // A pass the engine does not offer: only on a spec change its reason cites.
      const y = task.step?.yourTurn, onSpec = cmd.choice === 'pass' && y?.reason === 'rounds' && !y.advice?.options.includes('pass')
      const cited = onSpec ? citedSpecChange(task, cmd.reason) : undefined
      if (cited && 'refused' in cited) throw new HerdrError('refused', cited.refused)
      const plan = planOf(needPlan(), task, p), state = task.step ?? initialState(), step = currentStep(plan, state)?.id ?? ''
      const r = onEvent(plan, state, { kind: 'decide', by: 'coordinator', choice: cmd.choice, note: cmd.reason, ...(cited ? { spec: true as const } : {}) }, now)
      if (r.refused) throw new HerdrError('refused', r.refused)
      const line = r.effects.flatMap(e => (e.kind === 'log' ? [e.text] : [])).join('; ')
      const next = { ...task, step: r.state, ...(cited ? { specPass: { at: now, step, reason: cmd.reason } } : {}) }
      return { task: await store.logTask(next, by, line), effects: r.effects.filter(e => e.kind !== 'log'),
        ...(cited ? { tellUser: `In your next message, tell the user you passed ${step} of ${task.id} on the spec change of ${new Date(cited.at).toISOString().slice(0, 10)}: ${cmd.reason}` } : {}) }
    }
  }
}

// Why the coordinator may not change the template to `next`; the same checks
// when the user accepts it later, against the template as it is then.
function editRefusal(t: Template | null, next: Template, turn: Turn, key?: string) {
  const why = templateEditRefusal(t, next, turn, key)
  if (why) throw new HerdrError('refused', why)
}

// What became of a proposal; summary: its own changes (an older proposal,
// without them, against the workflow as it is now).
const answerOf = (p: Proposal, outcome: ProposalOutcome, by: string, t?: Template | null): ProposalAnswer =>
  ({ outcome, at: Date.now(), by, proposedAt: p.at, summary: changeSummary(p.changes ?? workflowChanges(t ?? null, p.template)) })
const answersOf = (rec?: CoordinatorRecord | null) => rec?.answers ?? (rec?.answered ? [rec.answered] : [])
// The record with one more answer, the oldest dropped past PROPOSAL_ANSWERS.
function withAnswer<R extends CoordinatorRecord>(rec: R, a?: ProposalAnswer | false): R {
  if (!a) return rec
  const { answered: _old, ...rest } = rec
  return { ...rest, answers: [...answersOf(rec), a].slice(-PROPOSAL_ANSWERS) } as R
}

// The user's answer to the coordinator's template change. Accepted: saved,
// written to the workflow's log (by the coordinator, with the user's sentence),
// and the role files show the new plans at once.
export async function answerProposal(deps: Deps, key: unknown, accept: unknown) {
  const { store } = deps
  const rec = typeof key === 'string' ? await store.coordinator(key) : null
  if (!rec?.proposal) throw new HerdrError('not_found', 'No template change waits for you')
  const { proposal, ...rest } = rec
  const p = (await store.projects()).find(x => x.key === rec.project)
  const t = p ? await store.workflow(p.key) : null
  const done = (outcome: ProposalOutcome) => store.saveCoordinator(withAnswer(rest, answerOf(proposal, outcome, 'user', t)))
  if (accept !== true) { await done('refused'); return { accepted: false } }
  // Its diff was made against that version: saved over a newer one, it would
  // undo a change the user made since.
  if ((t?.version ?? 1) !== proposal.base) {
    await done('outdated: the template changed since, propose again')
    throw new HerdrError('refused', 'The template changed since this proposal: ask the coordinator to propose again')
  }
  // The project's own workflow (a proposal made before workflows names the template it was copied from).
  const next = t ? { ...proposal.template, id: t.id } : proposal.template
  editRefusal(t, next, 'user', rec.project)
  await store.saveWorkflow(rec.project, next, { by: coordinatorBy(proposal.by === 'main' ? MAIN : rec.project), said: proposal.said })
  await done('accepted')
  await writeRoleFiles(deps, rec.project).catch(() => {})
  return { accepted: true }
}

// A program only (a model sent by an older client is ignored).
const agentOf = (v: { program?: unknown }): CoordinatorAgent | null => (isCoordinatorProgram(v.program) ? { program: v.program } : null)
const BAD_AGENT = 'program: an agent that can coordinate (claude, codex, omp…)'
const BAD_PROJECT_AGENT = 'program: claude or codex (a project coordinator needs one wherdr can keep out of the repository)'
// No agent chosen yet: Claude, as before (the client sends the user's first agent).
const FALLBACK: CoordinatorAgent = { program: 'claude' }

// A project's key, or the main coordinator's.
export const isCoordinatorKey = async (store: PmStore, key: unknown) =>
  key === MAIN || (typeof key === 'string' && (await store.projects()).some(p => p.key === key))

// The project's default coordinator agent, changed in one gesture.
export async function setCoordinatorAgent(store: PmStore, key: unknown, agent: { program?: unknown }) {
  const a = agentOf(agent)
  if (!a) throw new HerdrError('bad_input', BAD_AGENT)
  if (typeof key === 'string' && !canRunCoordinator(a.program, key)) throw new HerdrError('bad_input', BAD_PROJECT_AGENT)
  if (typeof key !== 'string' || !(await isCoordinatorKey(store, key))) throw new HerdrError('not_found', 'Unknown project')
  await store.saveCoordinator({ project: key, tokenHash: '', ...(await store.coordinator(key)), agent: a })
  return { agent: a }
}

// Asleep: its scheduled wakes are skipped, nothing to do or the new work limit of today reached.
function asleepOf(ap: Autopilot, tasks: Task[], c: CoordinatorRecord | null | undefined, now: number) {
  const k = ap.on ? scheduledWake(ap, tasks, c?.woke ?? {}, c?.userAt, today(c?.lookAdded, now)) : 'send'
  return k === 'idle' || k === 'limit' ? { asleep: k } : {}
}

// Each project's coordinator: who answers, the agent of its kept conversation, its pending change.
export async function coordinatorsView(store: PmStore): Promise<CoordinatorView[]> {
  if (!(await store.enabled())) return []
  const [tasks, runs, wakes, now] = [await store.tasks(), await store.runs(), await store.wakes(), Date.now()]
  const holds = await slotsOf(store, await store.projects())
  // The main coordinator first; it has no autopilot (each project's coordinator runs its own).
  return Promise.all([{ key: MAIN, name: await readAlfredName({}) }, ...await store.projects()].map(async (p) => {
    const c = await store.coordinator(p.key)
    const current = c?.proposal ? await store.workflow(p.key) : null
    const changes = c?.proposal ? c.proposal.changes ?? workflowChanges(current, c.proposal.template) : undefined
    const flow = c?.proposal && changes ? proposalFlow(current, c.proposal.template, changes.types[0]?.type) : undefined
    const autopilot = c?.autopilot ?? DEFAULT_AUTOPILOT, mine = tasks.filter(t => t.project === p.key)
    const next = nextWakeAt(c?.autopilot, c?.ranAt, c?.atRan, now)
    const paused = 'paused' in p ? p.paused ?? [] : []
    const busy = paused.filter(m => runs.some(r => r.state !== 'ended' && r.machine === m && mine.some(t => t.id === r.task)))
    return {
      ...(p.key === MAIN
        ? { main: true }
        : {
            autopilot, limits: limitsLeft(autopilot, mine, runs, now, holds),
            ...asleepOf(autopilot, mine, c, now), skippedToday: today(c?.skipped, now),
            ...(c?.woke?.at ? { wokeAt: c.woke.at } : {}),
            ...(next ? { nextWake: next } : {}),
            wakes: wakes.filter(w => w.coordinator === p.key).sort((a, b) => b.createdAt - a.createdAt).slice(0, 5),
          }),
      project: p.key, name: p.name, ...('machine' in p ? { machines: allowedMachines(p) } : {}), ...(paused.length ? { paused } : {}), ...(busy.length ? { busy } : {}), ...('git' in p && p.git === false ? { git: false as const } : {}), ...(c?.agent ? { agent: agentOf(c.agent) ?? FALLBACK } : {}), ...('from' in p && p.from ? { template: p.from.template } : {}),
      ...(c?.ran ? { ran: agentOf(c.ran) ?? FALLBACK } : {}), ...(c?.terminal ? { terminal: c.terminal } : {}),
      ...(c?.proposal ? { proposal: { diff: c.proposal.diff, at: c.proposal.at, changes, flow, by: c.proposal.by ?? (p.key === MAIN ? 'main' : p.key), ...(c.proposal.said ? { said: c.proposal.said } : {}), ...(c.proposal.saidAt ? { saidAt: c.proposal.saidAt } : {}) } } : {}),
      ...('label' in p && p.label ? { label: p.label } : {}), ...('color' in p && p.color ? { color: p.color } : {}),
      ...(answersOf(c).length ? { answers: answersOf(c) } : {}),
    }
  }))
}

// The role files (and the `wherdr` script) in the coordinator's own folder,
// ~/.wherdr/pm/coordinators/<KEY> on the project's machine; never ~/.claude
// or ~/.codex.
// The main coordinator's: Alfred's home (writeAlfredHome).
export async function writeRoleFiles(deps: Deps, key: string) {
  const { store } = deps
  if (key === MAIN) return { p: undefined, local: true, on: undefined, ...await writeAlfredHome(deps) }
  const projects = await store.projects()
  const found = projects.find(x => x.key === key)
  const p = found && await ensureVisibility(deps, found)
  if (!p) throw new HerdrError('not_found', 'Unknown project')
  const t = p ? await store.workflow(p.key) : null
  const { m, on } = machineOn(deps, p.machine)
  const home = await homeOf(deps, on)
  if (!home) throw new HerdrError('core', 'Home folder not found on the project\'s machine')
  const folder = `${home}/.wherdr/pm/coordinators/${key}`
  for (const [file, text] of Object.entries(roleFiles(p, t, EXAMPLES, m.local ? docsDir() : undefined)))
    if ((await exec(deps, on, WRITE_SCRIPT, [`${folder}/${file}`], text)).code !== 0) throw new HerdrError('core', `Could not write ${file}`)
  for (const [file, text] of Object.entries(OWN_ROLE_FILES))
    if ((await exec(deps, on, CREATE_SCRIPT, [`${folder}/${file}`], text)).code !== 0) throw new HerdrError('core', `Could not create ${file}`)
  await exec(deps, on, 'chmod 755 "$1"', [`${folder}/bin/wherdr`])
  return { p, local: !!m.local, on, folder, first: false, v2: false, none: false }
}

// wherdr's docs on its own machine: the install's, so an update brings new ones.
const docsDir = () => path.join(process.env.WHERDR_ROOT || process.cwd(), 'docs')

// At wherdr's start (an update included): every running coordinator's role
// files rewritten, Alfred's home too. Nothing else: no message, no wake; each
// one learns of an update on its next command (takeUpdateNotice).
export async function rewriteRoleFiles(deps: Deps) {
  for (const c of await deps.store.coordinators())
    if (c.terminal) await writeRoleFiles(deps, c.project).catch(() => {})
}

// The line the coordinator's next command starts with, once, when wherdr was
// updated since its session started; then it counts as told.
export async function takeUpdateNotice(store: PmStore, key: string | null) {
  const rec = key ? await store.coordinator(key) : null
  const line = updateNotice(rec, wherdrVersion())
  if (line) await store.saveCoordinator({ ...rec!, told: wherdrVersion() })
  return line
}

const alfredAgent = (program: unknown): CoordinatorAgent | null => (isAlfredProgram(program) ? { program } : null)
const readAlfredName = (deps: { alfredHome?: string }) => fs.readFile(path.join(homeOfAlfred(deps), 'identity.md'), 'utf8').then(alfredName, () => alfredName(''))

// The v2 projects, read now from herdr-projects' board on this machine (read only).
export async function v2Projects(store: PmStore, hpDir = projectsHome(process.env, HOME)): Promise<V2Candidate[]> {
  return readV2Projects(hpDir, await store.projects())
}

// Alfred's home, on wherdr's own machine: wherdr's files rewritten at each
// start (an update ships new ones), its own files created once.
// first: identity.md was just created, so this is its very first start.
// v2: the user comes from wherdr v2: its herdr-projects board has projects.
export async function writeAlfredHome(deps: Deps) {
  const folder = homeOfAlfred(deps)
  const projects = await deps.store.projects()
  const docs = docsDir()
  const docFiles = (await fs.readdir(docs).catch(() => [] as string[])).filter(n => n.endsWith('.md')).sort()
  const main = mainRoleFiles(projects)
  const v2 = (await v2Projects(deps.store)).length > 0
  const files = { ...main, ...alfredFiles({ home: folder, version: wherdrVersion(), docs, docFiles, pm: await deps.store.enabled(), projects, v2 }, main['AGENTS.md']!.split('\n')) }
  for (const [file, text] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(folder, file)), { recursive: true, mode: 0o700 })
    await fs.writeFile(path.join(folder, file), text, { mode: 0o600 })
  }
  await fs.chmod(path.join(folder, 'bin/wherdr'), 0o755)
  let first = false
  for (const [file, text] of Object.entries(OWN_FILES)) {
    try { await fs.writeFile(path.join(folder, file), text, { flag: 'wx', mode: 0o600 }); if (file === 'identity.md') first = true }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e }
  }
  return { folder, first, v2, none: !projects.length }
}

// The sidebar's Alfred row: its name (identity.md), the program the user chose
// (none yet: the sheet asks before its first start), the one running, and its conversation.
export async function alfredView(deps: { store: PmStore, alfredHome?: string }) {
  const c = await deps.store.coordinator(MAIN)
  return { name: await readAlfredName(deps), ...(c?.agent ? { program: c.agent.program } : {}), ...(c?.ran ? { ran: c.ran.program } : {}), ...(c?.terminal ? { terminal: c.terminal } : {}) }
}

// Where the coordinator reaches wherdr: loopback on the wherdr host; from
// another machine, wherdr's published (tailnet) address.
export interface CoordinatorUrls { local: string, remote?: string }
const LOOPBACK = /^(localhost|127\.|\[::1\])/
// here: the address the request came to (used when wherdr has no published one).
export function coordinatorUrls(here: URL): CoordinatorUrls {
  const port = process.env.NITRO_PORT || process.env.PORT || '7683'
  let published = ''
  try { published = JSON.parse(fsSync.readFileSync(APP_URL_FILE, 'utf8'))?.url || '' } catch {}
  const remote = published || ENV_APP_URL || (LOOPBACK.test(here.hostname) ? '' : here.origin)
  return { local: `http://127.0.0.1:${port}`, ...(remote ? { remote: remote.replace(/\/$/, '') } : {}) }
}

// When a project coordinator starts: its files, a new token, how to start it.
export async function prepareCoordinator(deps: Deps, key: string, program: CoordinatorProgram, urls: CoordinatorUrls, resume = false) {
  const { p, local, on, folder, first, v2, none } = await writeRoleFiles(deps, key)
  const url = local ? urls.local : urls.remote
  if (!url) throw new HerdrError('unreachable', 'The project\'s machine cannot reach this wherdr: publish it on your tailnet first (Settings › Phone)')
  const token = await issueToken(deps.store, key)
  if (key === MAIN) await issueAlfredToken(deps.store, folder!)
  // Alfred starts with its greeting (startPrompt); a resumed conversation had it already.
  const prompt = key === MAIN && !resume ? [startPrompt(first, await readAlfredName(deps), v2, none)] : []
  return { on, folder, argv: coordinatorArgs(program, folder, p?.path, p?.git === false, resume), prompt, env: { WHERDR_PM_TOKEN: token, WHERDR_URL: url, DISABLE_AUTOUPDATER: '1' } }
}

// Starts the coordinator in its folder, its harness's default model, token in its environment,
// its folder's bin/ (the `wherdr` script) first in its PATH.
// first: messages it gets once ready, after its own start prompt.
// resume: its last conversation again (after its machine restarted, say), with
// the agent that ran it, instead of a new one.
export async function startCoordinator(deps: Deps, key: unknown, agent: { program?: unknown, resume?: unknown }, urls: CoordinatorUrls, first: string[] = []) {
  if (typeof key !== 'string') throw new HerdrError('not_found', 'Unknown project')
  const before = await deps.store.coordinator(key)
  const resume = agent.resume === true
  if (resume && !before?.ran) throw new HerdrError('bad_input', 'No conversation to resume: start a new one')
  // No agent given: the project's default. Alfred: a program only, with its own default model.
  const a = resume ? agentOf(before!.ran!) : key === MAIN ? alfredAgent(agent.program ?? before?.agent?.program)
    : agentOf(agent.program === undefined ? before?.agent ?? FALLBACK : agent)
  if (!a) throw new HerdrError('bad_input', BAD_AGENT)
  if (!canRunCoordinator(a.program, key)) throw new HerdrError('bad_input', BAD_PROJECT_AGENT)
  const { program } = a
  if (resume && !canResume(program)) throw new HerdrError('bad_input', 'Only a Claude or Codex conversation can be resumed: start a new one')
  const c = await prepareCoordinator(deps, key, program, urls, resume)
  const prompt = [...c.prompt, ...first]
  // A resumed Codex reads a word after `resume --last` as a session: its messages are typed.
  const asArg = promptAsArg(program) && !resume
  const argv = [...c.argv, ...(asArg ? prompt : [])]
  const quote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`
  const { address } = await deps.call<{ address: string }>('terminal.run', {
    cwd: c.folder, ...(c.on ? { on: c.on } : {}), no_parent: true, wait: false, env: c.env,
    labels: { 'wherdr.install': await deps.store.install(), 'wherdr.coordinator': key },
    line: `${PATH_SETUP}; export PATH=${quote(`${c.folder}/bin`)}:"$PATH"; exec ${argv.map(quote).join(' ')}`,
  }, 30000)
  // Typed once the program is ready (in the background: it may wait on a dialog).
  if (!asArg) for (const text of prompt) void sendFirstMessage(deps, address, text).then(r => (r === 'dialog' ? sendAfterDialog(deps, address, text) : r)).catch(() => {})
  // Alfred keeps the agent the user picked as its own (a project coordinator keeps its default).
  // version: what this session knows (takeUpdateNotice tells it of an update).
  const { told: _told, ...rec } = (await deps.store.coordinator(key))!
  await deps.store.saveCoordinator({ ...rec, terminal: address, ran: { program }, version: wherdrVersion(), ...(key === MAIN ? { agent: a } : {}) })
  // This conversation replaces the one before (another agent's, or ended).
  if (before?.terminal && before.terminal !== address) await deps.call('terminal.kill', { terminal: before.terminal }, 15000).catch(() => {})
  return { terminal: address, folder: c.folder }
}
