// Actions des plugins Herdr : liste et exécution, sur la machine concernée.
// Tout passe par le socket API de Herdr (local, ou socket distant transféré par
// SSH, cf. machines.ts) en JSON : aucun shell, aucune interpolation. Herdr lance
// lui-même la commande argv du manifeste, en tâche de fond ; on suit son journal
// (plugin.log.list) quelques secondes pour donner le résultat.
import type { PluginAction, PluginActionResult } from '../../shared/types'
import { splitId } from '../../shared/ids'
import { log } from './env'
import { HerdrError, herdrOn, sleep } from './herdr'
import { findPane } from './state'
import { machineFor } from './actions'
import { ACTION_ID_RE, PLUGIN_ID_RE, type RawPlugin, type RawPluginAction, type RawPluginLog, logResult, normalizeActions } from './pluginPolicy'

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

export async function invokePluginAction(body: { machine?: unknown, pane_id?: unknown, plugin?: unknown, action?: unknown }): Promise<PluginActionResult> {
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

  // Contexte explicite : sans lui, Herdr prendrait le pane actif du terminal
  // attaché (celui que l'ordinateur regarde), pas celui de l'agent.
  const context: Record<string, string> = { invocation_source: 'wherdr' }
  if (pane) {
    context.focused_pane_id = splitId(pane.id).local
    context.tab_id = splitId(pane.tab).local
    context.workspace_id = splitId(pane.workspace).local
  }
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
