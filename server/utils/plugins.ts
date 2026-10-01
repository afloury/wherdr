// Herdr plugin actions: listing and running, on the relevant machine.
// Everything goes through Herdr's API socket (local, or remote socket forwarded over
// SSH, see machines.ts) as JSON: no shell, no interpolation. Herdr runs
// the manifest's argv command itself, in the background; we follow its log
// (plugin.log.list) for a few seconds to give the result.
import type { PluginAction, PluginActionResult } from '../../shared/types'
import { splitId } from '../../shared/ids'
import { HERDR_BIN, HERDR_CHILD_ENV, HOME, IN_DOCKER, log } from './env'
import { execFile } from 'node:child_process'
import { binaryOn } from './projectBoard'
import { getState } from './state'
import { HerdrError, herdrOn, sleep } from './herdr'
import { findPane } from './state'
import { isGitRepo, machineFor, underHome } from './actions'
import { ACTION_ID_RE, PLUGIN_ID_RE, REMOTE_PROJECTS_SCRIPT, type RawPlugin, type RawPluginAction, type RawPluginLog, actionContext, logResult, normalizeActions, outputTail, stripAnsi } from './pluginPolicy'
import { PROJECT_INPUTS, cleanProjectInput, projectCommandArgs, readOnlyMessage, repoArgument, setupHeader, tickerRunning } from '../../shared/projectsActions'

// List kept for a few seconds per machine (the menu asks again on every opening).
const CACHE_MS = 10000
const cache = new Map<string, { at: number, actions: PluginAction[] }>()

export async function listPluginActions(machineKey: string, fresh = false): Promise<PluginAction[]> {
  const m = machineFor(machineKey)
  const hit = cache.get(m.key)
  if (!fresh && hit && Date.now() - hit.at < CACHE_MS) return hit.actions
  const [a, p] = await Promise.all([
    herdrOn<{ actions?: RawPluginAction[] }>(m.key, 'plugin.action.list', {}, 8000),
    herdrOn<{ plugins?: RawPlugin[] }>(m.key, 'plugin.list', {}, 8000).catch(() => ({ plugins: [] })),
  ])
  const actions = normalizeActions(a.actions || [], p.plugins || [])
  cache.set(m.key, { at: Date.now(), actions })
  return actions
}

const WAIT_MS = 12000

export function pluginInputFields(plugin: string, action: string): string[] {
  return plugin === 'herdr-projects' ? PROJECT_INPUTS[action] || [] : []
}

// A plugin command rather than its popup: Herdr publishes no read or input
// stream for popups. argv and machine are always explicit.
type Machine = ReturnType<typeof machineFor>
async function runProjects(m: Machine, bin: string, args: string[]): Promise<{ code: number, stdout: string, stderr: string }> {
  if (m.exec) {
    const r = await m.exec(REMOTE_PROJECTS_SCRIPT, [(m as { bin?: string }).bin || 'herdr', bin, ...args], { timeoutMs: 60000 })
    return { code: r.code ?? 1, stdout: r.stdout.toString('utf8').trim(), stderr: r.stderr.trim() }
  }
  return new Promise(resolve => execFile(bin, args, {
    env: { ...HERDR_CHILD_ENV, HERDR_BIN_PATH: HERDR_BIN }, timeout: 60000, maxBuffer: 1024 * 1024,
  }, (err, stdout, stderr) => resolve({
    code: err ? (typeof err.code === 'number' ? err.code : 1) : 0,
    stdout: String(stdout).trim(), stderr: String(stderr || (err && !stdout ? err.message : '')).trim(),
  })))
}

async function projectsBin(m: Machine): Promise<string> {
  const bin = await binaryOn(m)
  if (!bin) throw new HerdrError('plugin_unavailable', 'binaire Projects introuvable')
  return bin
}

async function projectsCommand(m: Machine, args: string[], lang: 'fr' | 'en' = 'en'): Promise<string> {
  const r = await runProjects(m, await projectsBin(m), args)
  if (r.code !== 0) {
    const error = r.stderr || r.stdout || `code ${r.code}`
    // Read-only HOME (Docker): say what to mount rather than the raw error.
    const readOnly = readOnlyMessage(error, { docker: m.local && IN_DOCKER, lang })
    if (readOnly) log(`herdr-projects ${args[0]} : ${error}`)
    throw new HerdrError(readOnly ? 'read_only' : 'plugin_failed', readOnly || error)
  }
  return r.stdout
}

// In Docker, `open` and `adopt-workspace` start the herdr-projects ticker
// if it is not running: it would then run in the container (without gh, read-only
// HOME, routines outside the host environment) and, being the same
// version, the host would not replace it. We stop it right away: the next
// `herdr-projects` run on the host (coordinator's `thread start`, Herdr
// startup) starts one again in the right place.
async function withoutContainerTicker<T>(m: Machine, run: () => Promise<T>): Promise<T> {
  if (!m.local || !IN_DOCKER) return run()
  const bin = await projectsBin(m)
  const before = await runProjects(m, bin, ['ticker', 'status']).catch(() => null)
  try { return await run() }
  finally {
    if (before && before.code === 0 && !tickerRunning(before.stdout)) {
      const after = await runProjects(m, bin, ['ticker', 'status']).catch(() => null)
      if (after && tickerRunning(after.stdout)) {
        log('herdr-projects: ticker started in the container, stop requested (it will restart on the host)')
        runProjects(m, bin, ['ticker', 'stop']).then(r => r.code && log(`herdr-projects ticker stop : ${r.stderr || r.code}`))
      }
    }
  }
}

// "Check setup": `doctor` run like wherdr's other commands, with the
// binary version, HOME and Herdr config it sees at the top. Read-only
// (never --fix); non-zero code = some checks failed, the output stays useful.
async function projectsDoctor(m: Machine): Promise<PluginActionResult> {
  const bin = await projectsBin(m)
  const [version, doctor] = await Promise.all([
    runProjects(m, bin, ['--version']).catch(() => null),
    runProjects(m, bin, projectCommandArgs('doctor', {}, { session: m.session })),
  ])
  const home = m.local ? String(HERDR_CHILD_ENV.HOME || HOME) : m.home
  const full = stripAnsi([doctor.stdout, doctor.stderr].filter(Boolean).join('\n')).slice(-12000)
  return {
    status: doctor.code === 0 ? 'succeeded' : 'failed', exitCode: doctor.code,
    output: outputTail(full), full,
    setup: setupHeader({ version: version && version.code === 0 ? version.stdout : null, binary: bin, home }),
  }
}

export async function invokePluginAction(body: { machine?: unknown, pane_id?: unknown, plugin?: unknown, action?: unknown, input?: unknown, lang?: unknown }): Promise<PluginActionResult> {
  const plugin = String(body.plugin || '')
  const action = String(body.action || '')
  if (!PLUGIN_ID_RE.test(plugin) || !ACTION_ID_RE.test(action)) throw new HerdrError('bad_action', 'action invalide')
  // Machine: the pane's if there is one (an agent's menu), otherwise the requested one.
  const paneId = body.pane_id ? String(body.pane_id) : ''
  const pane = paneId ? findPane(paneId) : null
  if (paneId && !pane) throw new HerdrError('bad_pane', 'pane introuvable')
  const m = machineFor(pane ? splitId(pane.id).machine : body.machine)
  // Only an action that Herdr announces, at the expected place.
  const known = (await listPluginActions(m.key, true)).find(a => a.plugin === plugin && a.id === action)
  if (!known) throw new HerdrError('plugin_action_not_found', 'action introuvable sur cette machine')
  if (pane ? !known.agent : !known.machine) throw new HerdrError('bad_context', 'action non disponible ici')

  if (plugin === 'herdr-projects' && action === 'open-popup') {
    throw new HerdrError('popup_unavailable', 'Le panneau Projects est disponible dans le client Herdr ; ses saisies ne sont pas accessibles par l’API Herdr.')
  }
  if (plugin === 'herdr-projects' && action === 'doctor') {
    log(`plugin ${plugin}.${action}${m.local ? '' : ` sur ${m.label}`} (commande)`)
    return projectsDoctor(m)
  }
  const fields = pluginInputFields(plugin, action)
  if (fields.length) {
    const input = cleanProjectInput(action, body.input)
    if (!input) throw new HerdrError('bad_input', 'saisie du plugin invalide')
    if (action === 'adopt-workspace' && (!pane || !pane.agent || !pane.cwd)) {
      throw new HerdrError('bad_context', 'un agent et son dossier sont nécessaires dans ce space')
    }
    // "New project" repository: a Git folder under its machine's HOME (the
    // project's by default), passed as `path@<Herdr id>` if it is on another one.
    if (input.repo) {
      const rm = input.machine ? machineFor(input.machine) : m
      const repo = underHome(input.repo, rm.home)
      if (!repo || !(await isGitRepo(repo, rm))) throw new HerdrError('bad_input', `pas un dépôt Git : ${input.repo}`)
      const arg = repoArgument(repo, rm, m)
      if (!arg) throw new HerdrError('bad_input', `dépôt inutilisable depuis ${m.label} : ${repo}${rm === m ? '' : ` (${rm.label})`}`)
      input.repo = arg
    }
    delete input.machine
    const lang = (body as { lang?: unknown }).lang === 'fr' ? 'fr' : 'en'
    const args = projectCommandArgs(action, input, { pane: pane ? splitId(pane.id).local : undefined, cwd: pane?.cwd || undefined, session: m.session, lang })
    const exec = async (): Promise<PluginActionResult> => {
      const output = await projectsCommand(m, args, lang)
      // The "New project" panel then opens the project. Keep the creation
      // visible even if opening fails: the user can retry it.
      if (action === 'new') {
        const slug = /created `([^`]+)`/.exec(output)?.[1]
        if (slug) {
          try { return { status: 'succeeded', exitCode: 0, output: outputTail(`${output}\n${await projectsCommand(m, projectCommandArgs('open', { slug }, { session: m.session }), lang)}`) } }
          catch (e) { return { status: 'failed', exitCode: null, output: outputTail(`${output}\n${(e as Error).message}`) } }
        }
      }
      return { status: 'succeeded', exitCode: 0, output: outputTail(output) }
    }
    return ['new', 'open', 'adopt-workspace'].includes(action) ? withoutContainerTicker(m, exec) : exec()
  }

  // Explicit context: without it, Herdr would take the active pane of the attached
  // terminal (the one the computer is looking at), not the agent's.
  const context = actionContext(pane || null, getState().workspaces)
  const r = await herdrOn<{ log?: RawPluginLog }>(m.key, 'plugin.action.invoke', { plugin_id: plugin, action_id: action, context }, 10000)
  const logId = r.log && r.log.log_id
  log(`plugin ${plugin}.${action}${pane ? ` (${pane.id})` : ''}${m.local ? '' : ` on ${m.label}`} started`)
  let last: RawPluginLog | null | undefined = r.log
  const until = Date.now() + WAIT_MS
  while (logId && logResult(last).status === 'running' && Date.now() < until) {
    await sleep(400)
    const l = await herdrOn<{ logs?: RawPluginLog[] }>(m.key, 'plugin.log.list', { plugin_id: plugin, limit: 20 }, 5000).catch(() => null)
    last = (l && l.logs || []).find(x => x.log_id === logId) || last
  }
  const res = logResult(last)
  log(`plugin ${plugin}.${action} : ${res.status}${res.exitCode !== null ? ` (${res.exitCode})` : ''}`)
  return res
}
