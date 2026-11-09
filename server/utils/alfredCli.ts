// `wherdr alfred …` on the server: Alfred's token, kept in a file of its home
// (never in its environment, never sent off this machine), and its commands.
// A change is only described unless the call says --apply; Alfred applies it
// after the user's yes. Nothing here removes data.
import path from 'node:path'
import { CHANGES, SETTING_VALUES, alfredCommandList, dryRun, parseAlfredCommand, type AlfredPlan } from '../../shared/pm/alfredCli'
import { GUARDED_PROGRAMS, MAIN, type CoordinatorAgent } from '../../shared/pm/coordinator'
import { offeredAgents, readAgentOrder, readHiddenAgents } from '../../shared/agentList'
import { allowedMachines, cleanProjectInput, cleanProjectUpdate, machinesOf } from '../../shared/pm/project'
import { keyClash, projectOf as findProject, shownKey } from '../../shared/pm/projectKey'
import { HerdrError } from './herdr'
import { alfredTokenOk, coordinatorsView, readV2Projects, startCoordinator, type CoordinatorUrls, type V2Candidate } from './pmCoordinator'
import type { CoreAdminDeps } from './coreCreate'
import type { FolderCheck, PmStore } from './pmStore'
import { patchSettings, readSettings } from './settings'
import { saveProjectGuards } from './pmProject'
import { checkMachine } from './pmReady'
import { projectPlace } from '../../shared/pm/places'
import { EXAMPLES } from '../../shared/pm/examples'
import { DATA_DIR } from './env'

type Deps = CoreAdminDeps & { store: PmStore, check: FolderCheck, urls: CoordinatorUrls, settingsFile?: string, dataDir?: string }

const unb64 = (v: unknown) => (typeof v === 'string' ? Buffer.from(v, 'base64').toString('utf8') : v)

// POST /api/alfred/cli: { argv } (or { argv64 } from Alfred's `wherdr` script).
export async function runAlfredCommand(deps: Deps, token: unknown, body: { argv?: unknown, argv64?: unknown }) {
  if (!(await alfredTokenOk(deps.store, token))) throw new HerdrError('forbidden', 'Unknown Alfred token')
  const argv = Array.isArray(body.argv64) ? body.argv64.map(unb64) : body.argv
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
    if (id && !EXAMPLES.some(e => `example:${e.id}` === id) && !(await store.overview()).templates.some(t => t.id === id)) throw new HerdrError('not_found', `No template ${id} (see wherdr alfred templates)`)
  }
  // A project coordinator's agent: its default while the user offers it, else
  // their first offered agent that can run it (Settings › Agents), else Claude.
  const projectAgent = async (key: string): Promise<CoordinatorAgent> => {
    const s = await readSettings(deps.settingsFile)
    const offered = offeredAgents(GUARDED_PROGRAMS, readHiddenAgents(s.hiddenAgents ?? null), readAgentOrder(s.agentOrder ?? null)) as CoordinatorAgent['program'][]
    const own = (await coordinatorsView(store)).find(x => x.project === key)?.agent
    return own && offered.includes(own.program) ? own : { program: offered[0] ?? 'claude' }
  }
  // Its conversation runs: its terminal is a live pane. stopped: it ended (its
  // machine restarted, say), and `coordinator start --resume` takes it up again.
  const runState = (terminal?: string) => (!terminal ? { running: false } : deps.panes().some(p => p.coreAddress === terminal) ? { running: true } : { running: false, stopped: true })
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
      return { project: { ...p, machineName: machineName(p.machine) }, coordinator: c && { agent: (await projectAgent(p.key)).program, ...runState(c.terminal) }, tasks }
    }
    case 'templates': return { templates: (await store.overview()).templates, examples: EXAMPLES.map(e => ({ id: `example:${e.id}`, instructions: e.instructions, taskTypes: Object.keys(e.taskTypes), guards: e.guards })) }
    case 'v2': {
      const candidates = await readV2Projects(deps.dataDir)
      if (!candidates.length) return { fromV2: false }
      // The v3 project made from each: same folder (on any machine) or same name.
      const made = (c: V2Candidate) => projects.find(p => p.path === c.path || p.name === c.name)?.key ?? null
      return {
        fromV2: true, report: path.join(deps.dataDir ?? DATA_DIR, 'migration-report.md'),
        projects: candidates.map(c => ({ ...c, project: made(c) })),
        note: 'Folders are those of the machine v2 ran on (this one). Add tasks again with wherdr pm task add once the project has a template',
      }
    }
    case 'machines': return { machines: machines.map(m => ({ key: m.key, label: m.label, local: m.local, status: m.status })) }
    case 'coordinators': return { coordinators: await Promise.all((await coordinatorsView(store)).map(async c => ({ project: c.project, name: c.name, agent: c.main ? c.agent?.program : (await projectAgent(c.project)).program, ...runState(c.terminal) }))) }
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
    case 'project machine': {
      await needPm()
      const p = projectOf(cmd.key)
      const allowed = allowedMachines(p).slice(1)
      // The machine by its key or its label; one no longer known is removed by its key.
      const m = machines.find(x => x.key === cmd.machine) ?? machines.find(x => x.label === cmd.machine)
      const mk = m?.key ?? (cmd.action === 'remove' && allowed.includes(cmd.machine) ? cmd.machine : undefined)
      if (mk === undefined) throw new HerdrError('not_found', `Unknown machine ${cmd.machine} (see wherdr alfred machines)`)
      if (mk === p.machine) throw new HerdrError('bad_input', `${machineName(mk)} is the project's own machine`)
      if (cmd.action === 'remove') {
        if (!allowed.includes(mk)) return { unchanged: true, project: p.key, machines: allowedMachines(p).map(machineName) }
        return change({ change: [`project ${p.key}: its tasks no longer start on ${machineName(mk)} (tasks already there stay)`] },
          () => store.updateProject(p.key, { machines: allowed.filter(x => x !== mk) }))
      }
      const { update, errors } = cleanProjectUpdate({ machines: [...allowed.filter(x => x !== mk), mk], clones: { [mk]: cmd.clone } })
      const bad = update ? machinesOf(p, update).errors : errors
      if (!update || bad.length) throw new HerdrError('bad_input', bad.map(e => `${e.path}: ${e.message}`).join('; '))
      return change({
        change: [`project ${p.key}: its tasks may run on ${machineName(mk)}, in its clone ${update.clones![mk]}`, `then the readiness check of ${machineName(mk)} runs (read-only)`],
        remote: remoteOf(mk),
      }, async () => {
        const project = await store.updateProject(p.key, update)
        const ready = await checkMachine(deps, p.key, mk).catch((e: Error) => ({ refused: e.message }))
        return { project, ready }
      })
    }
    case 'coordinator start': {
      await needPm()
      const p = projectOf(cmd.key)
      const rec = await store.coordinator(p.key)
      if (cmd.resume && !rec?.ran) throw new HerdrError('bad_input', `The coordinator of ${p.key} has no conversation to resume: start a new one without --resume`)
      const agent = cmd.resume ? rec!.ran! : cmd.program ? { program: cmd.program } : await projectAgent(p.key)
      const running = runState(rec?.terminal).running
      return change({
        change: cmd.resume
          ? [`resume the last conversation of the coordinator of ${p.key} with ${agent.program} on ${machineName(p.machine)}`, ...(running ? ['its running terminal is stopped and replaced'] : [])]
          : [`start the coordinator of ${p.key} with ${agent.program} on ${machineName(p.machine)}`, ...(running ? ['its running conversation is stopped and replaced by a new one'] : [])],
        remote: remoteOf(p.machine),
      }, () => startCoordinator(deps, p.key, cmd.resume ? { resume: true } : agent, deps.urls))
    }
  }
}
