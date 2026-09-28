// Actions des plugins Herdr : liste et exécution, sur la machine concernée.
// Tout passe par le socket API de Herdr (local, ou socket distant transféré par
// SSH, cf. machines.ts) en JSON : aucun shell, aucune interpolation. Herdr lance
// lui-même la commande argv du manifeste, en tâche de fond ; on suit son journal
// (plugin.log.list) quelques secondes pour donner le résultat.
import type { PluginAction, PluginActionResult } from '../../shared/types'
import { splitId } from '../../shared/ids'
import { HERDR_BIN, HERDR_CHILD_ENV, log } from './env'
import { execFile } from 'node:child_process'
import { binaryOn } from './projectBoard'
import { getState } from './state'
import { HerdrError, herdrOn, sleep } from './herdr'
import { findPane } from './state'
import { machineFor } from './actions'
import { ACTION_ID_RE, PLUGIN_ID_RE, type RawPlugin, type RawPluginAction, type RawPluginLog, actionContext, logResult, normalizeActions } from './pluginPolicy'

// Liste gardée quelques secondes par machine (le menu la redemande à chaque ouverture).
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

const PROJECT_INPUTS: Record<string, string[]> = {
  new: ['name', 'goal'], 'adopt-workspace': ['name'], open: ['slug'], pause: ['slug'], resume: ['slug'],
}

export function pluginInputFields(plugin: string, action: string): string[] {
  return plugin === 'herdr-projects' ? PROJECT_INPUTS[action] || [] : []
}

// Une commande du plugin plutôt que sa popup : Herdr ne publie aucun flux de
// lecture ou de saisie pour les popups. argv et machine sont toujours explicites.
async function projectsCommand(m: ReturnType<typeof machineFor>, args: string[]): Promise<string> {
  const bin = await binaryOn(m)
  if (!bin) throw new HerdrError('plugin_unavailable', 'binaire Projects introuvable')
  if (m.exec) {
    const r = await m.exec('HERDR_BIN_PATH="$1"; shift; bin="$1"; shift; exec "$bin" "$@"', [(m as { bin?: string }).bin || 'herdr', bin, ...args], { timeoutMs: 60000 })
    if (r.code !== 0) throw new HerdrError('plugin_failed', r.stderr.trim() || r.stdout.toString('utf8').trim() || `code ${r.code}`)
    return r.stdout.toString('utf8').trim()
  }
  return new Promise((resolve, reject) => execFile(bin, args, {
    env: { ...HERDR_CHILD_ENV, HERDR_BIN_PATH: HERDR_BIN }, timeout: 60000, maxBuffer: 1024 * 1024,
  }, (err, stdout, stderr) => err
    ? reject(new HerdrError('plugin_failed', String(stderr || err.message).trim()))
    : resolve(String(stdout).trim())))
}

export async function invokePluginAction(body: { machine?: unknown, pane_id?: unknown, plugin?: unknown, action?: unknown, input?: unknown }): Promise<PluginActionResult> {
  const plugin = String(body.plugin || '')
  const action = String(body.action || '')
  if (!PLUGIN_ID_RE.test(plugin) || !ACTION_ID_RE.test(action)) throw new HerdrError('bad_action', 'action invalide')
  // Machine : celle du pane s'il y en a un (menu d'un agent), sinon celle demandée.
  const paneId = body.pane_id ? String(body.pane_id) : ''
  const pane = paneId ? findPane(paneId) : null
  if (paneId && !pane) throw new HerdrError('bad_pane', 'pane introuvable')
  const m = machineFor(pane ? splitId(pane.id).machine : body.machine)
  // Seulement une action que Herdr annonce, à l'endroit prévu.
  const known = (await listPluginActions(m.key, true)).find(a => a.plugin === plugin && a.id === action)
  if (!known) throw new HerdrError('plugin_action_not_found', 'action introuvable sur cette machine')
  if (pane ? !known.agent : !known.machine) throw new HerdrError('bad_context', 'action non disponible ici')

  if (plugin === 'herdr-projects' && action === 'open-popup') {
    throw new HerdrError('popup_unavailable', 'Le panneau Projects est disponible dans le client Herdr ; ses saisies ne sont pas accessibles par l’API Herdr.')
  }
  const fields = pluginInputFields(plugin, action)
  if (fields.length) {
    const input = body.input && typeof body.input === 'object' && !Array.isArray(body.input) ? body.input as Record<string, unknown> : {}
    const value = (key: string) => typeof input[key] === 'string' ? (input[key] as string).trim() : ''
    if (fields.some(key => typeof input[key] !== 'string' || value(key).length > 120) || !value(fields[0]!)) {
      throw new HerdrError('bad_input', 'saisie du plugin invalide')
    }
    let args: string[]
    if (action === 'adopt-workspace') {
      if (!pane || !pane.agent || !pane.cwd) throw new HerdrError('bad_context', 'un agent et son dossier sont nécessaires dans ce space')
      args = ['adopt-workspace', '--name', value('name'), '--pane', splitId(pane.id).local, '--workspace-cwd', pane.cwd]
    } else if (action === 'new') args = ['new', value('name'), '--goal', value('goal')]
    else args = [action, value('slug')]
    if ((action === 'adopt-workspace' || action === 'open') && m.session !== 'default') args.push('--session', m.session)
    const output = await projectsCommand(m, args)
    // Le panneau « New project » ouvre ensuite le projet. Garder la création
    // visible même si l’ouverture échoue : l’utilisateur peut la retenter.
    if (action === 'new') {
      const slug = /created `([^`]+)`/.exec(output)?.[1]
      if (slug) {
        try { return { status: 'succeeded', exitCode: 0, output: outputTail(`${output}\n${await projectsCommand(m, ['open', slug, ...(m.session !== 'default' ? ['--session', m.session] : [])])}`) } }
        catch (e) { return { status: 'failed', exitCode: null, output: outputTail(`${output}\n${(e as Error).message}`) } }
      }
    }
    return { status: 'succeeded', exitCode: 0, output: outputTail(output) }
  }

  // Contexte explicite : sans lui, Herdr prendrait le pane actif du terminal
  // attaché (celui que l'ordinateur regarde), pas celui de l'agent.
  const context = actionContext(pane || null, getState().workspaces)
  const r = await herdrOn<{ log?: RawPluginLog }>(m.key, 'plugin.action.invoke', { plugin_id: plugin, action_id: action, context }, 10000)
  const logId = r.log && r.log.log_id
  log(`plugin ${plugin}.${action}${pane ? ` (${pane.id})` : ''}${m.local ? '' : ` sur ${m.label}`} lancé`)
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
