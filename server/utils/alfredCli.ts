// `wherdr alfred …` on the server: Alfred's token, kept in a file of its home
// (never in its environment, never sent off this machine), and its commands.
// A change is only described unless the call says --apply; Alfred applies it
// after the user's yes. Nothing here removes data.
import { CHANGES, alfredCommandList, dryRun, parseAlfredCommand, type AlfredPlan } from '../../shared/pm/alfredCli'
import { MAIN, agentName } from '../../shared/pm/coordinator'
import { cleanProjectInput } from '../../shared/pm/project'
import { HerdrError } from './herdr'
import { alfredTokenOk, coordinatorsView, startCoordinator, type CoordinatorUrls } from './pmCoordinator'
import type { CoreAdminDeps } from './coreCreate'
import type { FolderCheck, PmStore } from './pmStore'
import { patchSettings, readSettings } from './settings'

type Deps = CoreAdminDeps & { store: PmStore, check: FolderCheck, urls: CoordinatorUrls, settingsFile?: string }

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
    const p = projects.find(x => x.key === key)
    if (!p) throw new HerdrError('not_found', `Unknown project ${key}: ${projects.map(x => x.key).join(', ') || 'none yet'}`)
    return p
  }
  const machineName = (key: string) => (key ? machines.find(m => m.key === key)?.label ?? key : 'this machine')
  const remoteOf = (key: string) => (key && !machines.find(m => m.key === key)?.local ? machineName(key) : undefined)
  const needPm = async () => { if (!(await store.enabled())) throw new HerdrError('pm_off', 'Projects are off: the user switches them on in Settings › Projects') }
  const knownTemplate = async (id: string) => {
    if (id && !(await store.overview()).templates.some(t => t.id === id)) throw new HerdrError('not_found', `No template ${id} (see wherdr alfred templates)`)
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
      return { project: { ...p, machineName: machineName(p.machine) }, coordinator: c && { agent: agentName(c.agent), running: !!c.terminal }, tasks }
    }
    case 'templates': return { templates: (await store.overview()).templates }
    case 'machines': return { machines: machines.map(m => ({ key: m.key, label: m.label, local: m.local, status: m.status })) }
    case 'coordinators': return { coordinators: (await coordinatorsView(store)).map(c => ({ project: c.project, name: c.name, agent: agentName(c.agent), running: !!c.terminal })) }
    case 'coordinator open': {
      const c = (await coordinatorsView(store)).find(x => x.project === cmd.key)
      const pane = c?.terminal ? deps.panes().find(p => p.coreAddress === c.terminal) : undefined
      if (!pane) throw new HerdrError('not_found', `The coordinator of ${cmd.key} is not running: start it with wherdr alfred coordinator start ${cmd.key}`)
      return { link: `${deps.urls.remote ?? deps.urls.local}/#/a/${encodeURIComponent(pane.id)}`, note: 'Give the user this link; the sidebar shows it too' }
    }
    case 'settings': return { settings: await readSettings(deps.settingsFile) }
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
      if (projects.some(p => p.key === project.key)) throw new HerdrError('exists', 'A project already has this key')
      await knownTemplate(project.template ?? '')
      return change({
        change: [`add project ${project.key} "${project.name}"`, `folder ${project.path} on ${machineName(project.machine)} (checked to be a git repository)`, `template ${project.template ?? 'none'}`],
        remote: remoteOf(project.machine),
      }, () => store.addProject(project, deps.check))
    }
    case 'project template': {
      await needPm()
      const p = projectOf(cmd.key)
      await knownTemplate(cmd.template)
      if ((p.template ?? '') === cmd.template) return { unchanged: true, project: p.key, template: p.template ?? 'none' }
      return change({ change: [`project ${p.key} template: ${p.template ?? 'none'} → ${cmd.template || 'none'}`] }, () => store.setTemplate(p.key, cmd.template))
    }
    case 'coordinator start': {
      await needPm()
      const p = projectOf(cmd.key)
      const rec = await store.coordinator(p.key)
      const agent = cmd.program ? { program: cmd.program, model: cmd.model! } : (await coordinatorsView(store)).find(x => x.project === p.key)!.agent
      return change({
        change: [`start the coordinator of ${p.key} with ${agentName(agent)} on ${machineName(p.machine)}`, ...(rec?.terminal ? ['its running conversation is stopped and replaced by a new one'] : [])],
        remote: remoteOf(p.machine),
      }, () => startCoordinator(deps, p.key, agent, deps.urls))
    }
  }
}
