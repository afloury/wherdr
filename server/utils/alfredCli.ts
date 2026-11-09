// `wherdr alfred …` on the server: Alfred's token, kept in a file of its home
// (never in its environment, never sent off this machine), and its commands.
// A change is only described unless the call says --apply; Alfred applies it
// after the user's yes. Nothing here removes data.
import { CHANGES, SETTING_VALUES, alfredCommandList, dryRun, parseAlfredCommand, workflowEditRefusal, type AlfredPlan } from '../../shared/pm/alfredCli'
import { GUARDED_PROGRAMS, MAIN, templateDiff, type CoordinatorAgent } from '../../shared/pm/coordinator'
import { EXAMPLES } from '../../shared/pm/examples'
import { validateTemplate, type Template } from '../../shared/pm/workflow'
import { templateChanges } from '../../shared/pm/templateText'
import { ALFRED } from '../../shared/pm/alfred'
import type { Pane } from '../../shared/types'
import { offeredAgents, readAgentOrder, readHiddenAgents } from '../../shared/agentList'
import { cleanProjectInput } from '../../shared/pm/project'
import { keyClash, projectOf as findProject, shownKey } from '../../shared/pm/projectKey'
import { HerdrError } from './herdr'
import { alfredTokenOk, coordinatorsView, noteTurn, startCoordinator, type CoordinatorUrls } from './pmCoordinator'
import { sendAfterDialog, sendFirstMessage, type CoreAdminDeps } from './coreCreate'
import type { FolderCheck, PmStore } from './pmStore'
import { patchSettings, readSettings } from './settings'
import { saveProjectGuards } from './pmProject'
import { projectPlace } from '../../shared/pm/places'

// reply: an agent's last reply, read from its conversation.
type Deps = CoreAdminDeps & { store: PmStore, check: FolderCheck, urls: CoordinatorUrls, settingsFile?: string, reply?: (pane: Pane) => Promise<{ text: string } | null> }

// A turn the server saw start over an hour ago is not trusted any more (as a coordinator's).
const TURN_MS = 3_600_000

const unb64 = (v: unknown) => (typeof v === 'string' ? Buffer.from(v, 'base64').toString('utf8') : v)

// POST /api/alfred/cli: { argv } (or { argv64 } from Alfred's `wherdr` script).
export async function runAlfredCommand(deps: Deps, token: unknown, body: { argv?: unknown, argv64?: unknown, input?: unknown, input64?: unknown }) {
  if (!(await alfredTokenOk(deps.store, token))) throw new HerdrError('forbidden', 'Unknown Alfred token')
  const argv = Array.isArray(body.argv64) ? body.argv64.map(unb64) : body.argv
  const input = body.input64 !== undefined ? unb64(body.input64) : body.input
  const cmd = parseAlfredCommand(argv)
  if ('error' in cmd) throw new HerdrError('bad_input', cmd.error)
  const { store } = deps
  const projects = await store.projects()
  const machines = deps.machines()
  const projectOf = (key: string) => {
    const p = findProject(projects, key)
    if (!p) throw new HerdrError('not_found', `Unknown project ${key}: ${projects.map(shownKey).join(', ') || 'none yet'}`)
    return p
  }
  const machineName = (key: string) => (key ? machines.find(m => m.key === key)?.label ?? key : 'this machine')
  const remoteOf = (key: string) => (key && !machines.find(m => m.key === key)?.local ? machineName(key) : undefined)
  const needPm = async () => { if (!(await store.enabled())) throw new HerdrError('pm_off', `Projects are off: the user switches them on in ${projectPlace(undefined, 'general', true)}`) }
  const knownTemplate = async (id: string) => {
    if (id && !(await store.overview()).templates.some(t => t.id === id)) throw new HerdrError('not_found', `No template ${id} (see wherdr alfred templates)`)
  }
  // A project coordinator's agent: its default while the user offers it, else
  // their first offered agent that can run it (Settings › Agents), else Claude.
  const projectAgent = async (key: string): Promise<CoordinatorAgent> => {
    const s = await readSettings(deps.settingsFile)
    const offered = offeredAgents(GUARDED_PROGRAMS, readHiddenAgents(s.hiddenAgents ?? null), readAgentOrder(s.agentOrder ?? null)) as CoordinatorAgent['program'][]
    const own = (await coordinatorsView(store)).find(x => x.project === key)?.agent
    return own && offered.includes(own.program) ? own : { program: offered[0] ?? 'claude' }
  }
  // Alfred's own turn: from the user's message, or a wake (or too old to know).
  const alfredTurn = async () => {
    const t = (await store.coordinator(MAIN))?.turn
    return t && Date.now() - t.at < TURN_MS ? t : undefined
  }
  // The project coordinator's terminal, when it runs.
  const coordinatorPane = async (key: string) => {
    const c = await store.coordinator(key)
    return c?.terminal ? deps.panes().find(p => p.coreAddress === c.terminal) : undefined
  }
  // A change: its plan, then (with --apply) the change itself.
  const change = async (plan: AlfredPlan, make: () => Promise<unknown>) => ('apply' in cmd && cmd.apply ? { applied: true, change: plan.change, result: await make() } : dryRun(argv as string[], plan))

  switch (cmd.name) {
    case 'help': return { commands: alfredCommandList(), note: `Changes (${CHANGES.join(', ')}) are only shown without --apply` }
    case 'projects': return { enabled: await store.enabled(), projects: projects.map(p => ({ ...p, machineName: machineName(p.machine) })) }
    case 'project': {
      const p = projectOf(cmd.key)
      const c = (await coordinatorsView(store)).find(x => x.project === p.key)
      const tasks: Record<string, number> = {}
      for (const t of await store.tasks()) if (t.project === p.key) tasks[t.state] = (tasks[t.state] ?? 0) + 1
      return { project: { ...p, machineName: machineName(p.machine) }, coordinator: c && { agent: (await projectAgent(p.key)).program, running: !!c.terminal, ...(c.proposal ? { proposalWaits: { by: c.proposal.by ?? 'the coordinator', at: c.proposal.at } } : {}) }, tasks }
    }
    case 'templates': return { templates: (await store.overview()).templates, examples: EXAMPLES.map(e => `example:${e.id}`) }
    case 'machines': return { machines: machines.map(m => ({ key: m.key, label: m.label, local: m.local, status: m.status })) }
    case 'coordinators': return { coordinators: await Promise.all((await coordinatorsView(store)).map(async c => ({ project: c.project, name: c.name, agent: c.main ? c.agent?.program : (await projectAgent(c.project)).program, running: !!c.terminal }))) }
    case 'coordinator open': {
      const c = (await coordinatorsView(store)).find(x => x.project === (findProject(projects, cmd.key)?.key ?? cmd.key))
      const pane = c?.terminal ? deps.panes().find(p => p.coreAddress === c.terminal) : undefined
      if (!pane) throw new HerdrError('not_found', `The coordinator of ${cmd.key} is not running: start it with wherdr alfred coordinator start ${cmd.key}`)
      return { link: `${deps.urls.remote ?? deps.urls.local}/#/a/${encodeURIComponent(pane.id)}`, note: 'Give the user this link; the sidebar shows it too' }
    }
    case 'settings': return { settings: await readSettings(deps.settingsFile), values: SETTING_VALUES, note: 'Alfred changes only the settings listed in values, to one of their values (1 = on, 0 = off)' }
    case 'setting set': {
      const old = (await readSettings(deps.settingsFile))[cmd.key]
      if (old === cmd.value) return { unchanged: true, [cmd.key]: old }
      return change({ change: [`setting ${cmd.key}: ${old === undefined ? '(default)' : JSON.stringify(old)} → ${JSON.stringify(cmd.value)}`] },
        async () => ({ [cmd.key]: (await patchSettings({ [cmd.key]: cmd.value }, { file: deps.settingsFile }))[cmd.key] }))
    }
    case 'project add': {
      await needPm()
      // The machine by its key or its label.
      const m = machines.find(x => x.key === cmd.input.machine) ?? machines.find(x => x.label === cmd.input.machine)
      if (!m && cmd.input.machine) throw new HerdrError('not_found', `Unknown machine ${cmd.input.machine} (see wherdr alfred machines)`)
      const { project, errors } = cleanProjectInput({ ...cmd.input, machine: m?.key ?? '' })
      if (!project) throw new HerdrError('bad_input', errors.map(e => `${e.path}: ${e.message}`).join('; '))
      if (keyClash(projects, project.key)) throw new HerdrError('exists', 'A project already has this key')
      await knownTemplate(project.template ?? '')
      // The folder checks --apply makes (inside the home folder, a git
      // repository, not already a project): read-only, so run before the
      // user's yes on this machine; on another, only once the user asked.
      const remote = remoteOf(project.machine)
      const folder = remote ? project.path : await deps.check(project.machine, project.path)
      if (projects.some(p => p.machine === project.machine && p.path === folder)) throw new HerdrError('exists', 'This folder is already a project')
      return change({
        change: [`add project ${project.key} "${project.name}"`,
          remote ? `folder ${folder} on ${machineName(project.machine)} (checked when applied: inside the home folder, a git repository, not already a project)` : `folder ${folder} on ${machineName(project.machine)} (checked: a git repository)`,
          `template ${project.template ?? 'none'}`],
        remote,
      }, () => store.addProject(project, deps.check))
    }
    case 'project template': {
      await needPm()
      const p = projectOf(cmd.key)
      await knownTemplate(cmd.template)
      if (!cmd.template && !p.from) return { unchanged: true, project: p.key, template: 'none' }
      return change({ change: [`project ${p.key} template: ${p.from?.template ?? 'none'} → ${cmd.template || 'none'}`] }, () => store.setTemplate(p.key, cmd.template))
    }
    case 'project workflow': {
      await needPm()
      const p = projectOf(cmd.key)
      // A template by its id, an example by example:<id> (or its bare id when no template has it).
      const templates = (await store.overview()).templates
      const bare = !cmd.from.startsWith('example:') && !templates.some(t => t.id === cmd.from) ? `example:${cmd.from}` : cmd.from
      if (bare.startsWith('example:') && !EXAMPLES.some(e => `example:${e.id}` === bare)) throw new HerdrError('not_found', `No template or example ${cmd.from} (see wherdr alfred templates)`)
      const old = await store.workflow(p.key)
      return change({ change: [old ? `replace the workflow of ${p.key} (v${old.version ?? 1}) with a copy of ${bare}; its guards stay` : `start the workflow of ${p.key} as a copy of ${bare}`] },
        () => store.setTemplate(p.key, bare, { keepGuards: true, by: ALFRED }))
    }
    case 'project workflow edit': {
      await needPm()
      const p = projectOf(cmd.key)
      const old = await store.workflow(p.key)
      let next: Template
      try { next = JSON.parse(String(input ?? '')) as Template } catch { throw new HerdrError('bad_input', 'The new workflow is not valid JSON (give it on stdin)') }
      if (!next || typeof next !== 'object' || Array.isArray(next)) throw new HerdrError('bad_input', 'The new workflow is a JSON object')
      // Always the project's own workflow, whatever id the JSON names.
      if (old) next = { ...next, id: old.id }
      const turn = await alfredTurn()
      const why = workflowEditRefusal(old, next, turn?.kind ?? 'none', p.key)
      if (why) throw new HerdrError('refused', why)
      const errors = validateTemplate(next)
      if (errors.length) throw new HerdrError('bad_input', errors.map(e => `${e.path}: ${e.message}`).join('; '))
      // Saved where the coordinator's proposal waits: the user answers it in the same review.
      const rec = await store.coordinator(p.key)
      const proposal = { template: next, diff: templateDiff(old, next), at: Date.now(), base: old!.version ?? 1, by: ALFRED, ...(turn?.said ? { said: turn.said } : {}) }
      await store.saveCoordinator({ project: p.key, tokenHash: '', ...rec, proposal })
      return {
        proposed: true, changes: templateChanges(old, next), diff: proposal.diff,
        ...(rec?.proposal ? { replaced: `the change proposed by ${rec.proposal.by ?? 'the coordinator'} that waited` } : {}),
        next: `The user accepts or refuses it in ${projectPlace(p.key, 'workflow', true)}; wherdr alfred project ${p.key} shows whether it still waits`,
      }
    }
    case 'tell': {
      await needPm()
      const p = projectOf(cmd.key)
      const pane = await coordinatorPane(p.key)
      const started = !pane
      const terminal = pane?.coreAddress ?? (await startCoordinator(deps, p.key, await projectAgent(p.key), deps.urls)).terminal
      // The coordinator's turn is the user's when Alfred relays the user's message; a wake's otherwise.
      const turn = await alfredTurn()
      await noteTurn(store, p.key, turn?.kind === 'user' ? 'user' : 'wake', turn?.said)
      const text = `From ${ALFRED}: ${cmd.text}`
      if (started) void sendFirstMessage(deps, terminal, text).then(r => (r === 'dialog' ? sendAfterDialog(deps, terminal, text) : r)).catch(() => {})
      else await deps.call('terminal.send', { terminal, text }, 30000)
      await store.logProject(p.key, { by: ALFRED, text: `told the coordinator: ${cmd.text.slice(0, 300)}`, ...(turn?.said ? { said: turn.said } : {}) })
      return { told: p.key, ...(started ? { started: `its coordinator was not running: started on ${machineName(p.machine)}, the message goes once it is ready` } : {}), next: `Read its answer later with wherdr alfred last ${p.key}` }
    }
    case 'last': {
      const p = projectOf(cmd.key)
      const pane = await coordinatorPane(p.key)
      if (!pane) throw new HerdrError('not_found', `The coordinator of ${p.key} is not running: wherdr alfred tell ${p.key} "<text>" starts it`)
      const reply = (await deps.reply?.(pane).catch(() => null)) ?? null
      return { project: p.key, working: pane.status === 'working', reply: reply?.text ?? null }
    }
    case 'project guards': {
      await needPm()
      const p = projectOf(cmd.key)
      const t = await store.workflow(p.key)
      if (!t) throw new HerdrError('not_found', `Project ${p.key} has no workflow: give it a template first`)
      const old = t.guards ?? {}, { protect, mergeProtected, mergeOthers, contributorPrs } = cmd.change
      if (!protect && !mergeProtected && !mergeOthers && !contributorPrs) return { project: p.key, guards: old }
      const merge = { ...old.merge, ...(mergeProtected ? { protected: mergeProtected } : {}), ...(mergeOthers ? { others: mergeOthers } : {}) }
      const branches = protect ?? old.protected
      const cp = contributorPrs ? (contributorPrs === 'off' ? undefined : contributorPrs) : old.contributorPrs
      const guards = { ...(branches ? { protected: branches } : {}), ...(Object.keys(merge).length ? { merge } : {}), ...(cp ? { contributorPrs: cp } : {}) }
      return change({ change: [`project ${p.key} guards: ${JSON.stringify(old)} → ${JSON.stringify(guards)}`] }, () => saveProjectGuards(store, p.key, guards, 'Alfred', deps))
    }
    case 'coordinator start': {
      await needPm()
      const p = projectOf(cmd.key)
      const rec = await store.coordinator(p.key)
      const agent = cmd.program ? { program: cmd.program } : await projectAgent(p.key)
      return change({
        change: [`start the coordinator of ${p.key} with ${agent.program} on ${machineName(p.machine)}`, ...(rec?.terminal ? ['its running conversation is stopped and replaced by a new one'] : [])],
        remote: remoteOf(p.machine),
      }, () => startCoordinator(deps, p.key, agent, deps.urls))
    }
  }
}
