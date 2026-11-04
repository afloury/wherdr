// A project coordinator on the server: its token (one per project, scoped to
// it), where its current turn comes from, the `wherdr pm` commands it runs,
// and its role files, written in its own folder on the project's machine.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { parseCommand, roleFiles, stepDoneEvent, templateEditRefusal, coordinatorArgs, type Turn } from '../../shared/pm/coordinator'
import { initialState, onEvent, planSteps, currentStep } from '../../shared/pm/steps'
import { templateChanges } from '../../shared/pm/templateText'
import { EXAMPLES } from '../../shared/pm/examples'
import type { Template } from '../../shared/pm/workflow'
import type { Task } from '../../shared/pm/run'
import { HerdrError } from './herdr'
import { PATH_SETUP, homeOf, machineOn, type CoreAdminDeps } from './coreCreate'
import { WRITE_SCRIPT, exec } from './pmLaunch'
import { userStep } from './pmBoard'
import type { PmStore } from './pmStore'

type Deps = CoreAdminDeps & { store: PmStore }
const sha = (s: string) => createHash('sha256').update(s).digest()

// A new token for the project's coordinator; the one before stops working.
export async function issueToken(store: PmStore, key: string) {
  const token = randomBytes(32).toString('hex')
  await store.saveCoordinator({ project: key, tokenHash: sha(token).toString('hex') })
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

// Called by whatever delivers a message to the coordinator: the user's
// message from the interface (with its text) or an engine wake.
export async function noteTurn(store: PmStore, key: string, kind: 'user' | 'wake', said?: string) {
  const c = await store.coordinator(key)
  if (!c) throw new HerdrError('not_found', 'No coordinator for this project')
  await store.saveCoordinator({ ...c, turn: { kind, at: Date.now(), ...(kind === 'user' && said ? { said: said.slice(0, 500) } : {}) } })
}

const TURN_MS = 3_600_000

// The user's message sent from the interface to a terminal: when that
// terminal is a project coordinator, its turn now comes from the user.
export async function userMessageTo(store: PmStore, terminal: string | undefined, text: string) {
  if (!terminal || !(await store.enabled())) return
  const c = (await store.coordinators()).find(x => x.terminal === terminal)
  if (c) await noteTurn(store, c.project, 'user', text)
}

const planOf = (t: Template, task: Task) => planSteps(t, { type: task.type, ...(task.prefs ? { prefs: task.prefs } : {}) })
const summary = (t: Template | null, task: Task) => {
  const step = t ? currentStep(planOf(t, task), task.step ?? initialState()) : undefined
  return { id: task.id, title: task.title, type: task.type, state: task.state, step: step?.id, holder: step?.holder, yourTurn: task.step?.yourTurn?.badge, tags: task.tags, links: task.links }
}

// POST /api/pm/cli: { argv, input? } with the coordinator's token.
export async function runCommand(deps: Deps, token: unknown, body: { argv?: unknown, input?: unknown }) {
  const { store } = deps
  const key = await scopeOf(store, token)
  if (!key) throw new HerdrError('forbidden', 'Unknown coordinator token')
  const cmd = parseCommand(body.argv)
  if ('error' in cmd) throw new HerdrError('bad_input', cmd.error)
  const projects = await store.projects()
  const p = projects.find(x => x.key === key)
  if (!p) throw new HerdrError('not_found', 'Unknown project')
  const t = p.template ? await store.template(p.template) : null
  const rec = await store.coordinator(key)
  // A turn the server saw start over an hour ago is not trusted any more.
  const turn: Turn = rec?.turn && Date.now() - rec.turn.at < TURN_MS ? rec.turn.kind : 'none'
  const by = `coordinator ${key}`
  // Another project's task reads as unknown: the token sees its project only.
  const taskOf = async (id: string) => {
    const task = await store.task(id)
    if (!task || task.project !== key) throw new HerdrError('not_found', 'Unknown task')
    return task
  }
  const needPlan = () => { if (!t) throw new HerdrError('not_found', 'The project has no template'); return t }

  switch (cmd.name) {
    case 'list': return { tasks: (await store.tasks()).filter(x => x.project === key).map(x => summary(t, x)) }
    case 'show': { const task = await taskOf(cmd.task); return { task: { ...summary(t, task), description: task.description, log: task.log ?? [] }, plan: t ? planOf(t, task) : [] } }
    case 'plan': return { template: t && { id: t.id, version: t.version }, plans: Object.fromEntries(Object.keys(needPlan().taskTypes).map(type => [type, planSteps(t!, { type })])) }
    case 'template show': return { template: needPlan() }
    case 'template edit': {
      let next: Template
      try { next = JSON.parse(String(body.input ?? '')) as Template } catch { throw new HerdrError('bad_input', 'The new template is not valid JSON') }
      const why = templateEditRefusal(t, next, turn)
      if (why) throw new HerdrError('refused', why)
      const other = projects.find(x => x.key !== key && x.template === t!.id)
      if (other) throw new HerdrError('refused', `Template ${t!.id} is also used by project ${other.key}: the user changes it in Settings › Projects`)
      const saved = await store.saveTemplate(next, { replace: true, by, said: rec?.turn?.said })
      return { ...saved, changes: templateChanges(t, next) }
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
      const plan = planOf(needPlan(), task)
      const state = task.step ?? initialState()
      const ev = stepDoneEvent(currentStep(plan, state), cmd, turn)
      if ('refused' in ev) throw new HerdrError('refused', ev.refused)
      const step = currentStep(plan, state)!.id
      // The user's words: the same path as the step's button (runs its check).
      if (ev.kind === 'user') return { task: await store.logTask(await userStep(deps, task.id), by, `${step}: the user said "${cmd.userSaid}"`) }
      const r = onEvent(plan, state, ev, Date.now())
      if (r.refused) throw new HerdrError('refused', r.refused)
      return { task: await store.logTask({ ...task, step: r.state }, by, `${step}: done`) }
    }
    case 'task decide': {
      const task = await taskOf(cmd.task)
      const r = onEvent(planOf(needPlan(), task), task.step ?? initialState(), { kind: 'decide', by: 'coordinator', choice: cmd.choice, note: cmd.reason }, Date.now())
      if (r.refused) throw new HerdrError('refused', r.refused)
      const line = r.effects.flatMap(e => (e.kind === 'log' ? [e.text] : [])).join('; ')
      return { task: await store.logTask({ ...task, step: r.state }, by, line), effects: r.effects.filter(e => e.kind !== 'log') }
    }
  }
}

// When a project coordinator starts: a new token, the role files in its own
// folder (~/.wherdr/pm/coordinators/<KEY> on the project's machine; never
// ~/.claude or ~/.codex), and how to start it there.
export async function prepareCoordinator(deps: Deps, key: string, agent: { program: 'claude' | 'codex', model: string }, url: string) {
  const { store } = deps
  const p = (await store.projects()).find(x => x.key === key)
  if (!p) throw new HerdrError('not_found', 'Unknown project')
  const t = p.template ? await store.template(p.template) : null
  const { on } = machineOn(deps, p.machine)
  const home = await homeOf(deps, on)
  if (!home) throw new HerdrError('core', 'Home folder not found on the project\'s machine')
  const folder = `${home}/.wherdr/pm/coordinators/${key}`
  for (const [file, text] of Object.entries(roleFiles(p, t, EXAMPLES)))
    if ((await exec(deps, on, WRITE_SCRIPT, [`${folder}/${file}`], text)).code !== 0) throw new HerdrError('core', `Could not write ${file}`)
  const token = await issueToken(store, key)
  return { on, folder, argv: coordinatorArgs(agent.program, agent.model, folder, p.path), env: { WHERDR_PM_TOKEN: token, WHERDR_URL: url, DISABLE_AUTOUPDATER: '1' } }
}

// Starts the coordinator in its folder, model pinned, token in its environment.
export async function startCoordinator(deps: Deps, key: unknown, agent: { program?: unknown, model?: unknown }, url: string) {
  const program = agent.program === 'codex' ? 'codex' : agent.program === 'claude' ? 'claude' : null
  if (!program || typeof agent.model !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:[\]/-]{0,63}$/.test(agent.model))
    throw new HerdrError('bad_input', 'program: claude or codex, and a model')
  if (typeof key !== 'string') throw new HerdrError('not_found', 'Unknown project')
  const c = await prepareCoordinator(deps, key, { program, model: agent.model }, url)
  const quote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`
  const { address } = await deps.call<{ address: string }>('terminal.run', {
    cwd: c.folder, ...(c.on ? { on: c.on } : {}), no_parent: true, wait: false, env: c.env,
    labels: { 'wherdr.install': await deps.store.install(), 'wherdr.coordinator': key },
    line: `${PATH_SETUP}; exec ${c.argv.map(quote).join(' ')}`,
  }, 30000)
  await deps.store.saveCoordinator({ ...(await deps.store.coordinator(key))!, terminal: address })
  return { terminal: address, folder: c.folder }
}
