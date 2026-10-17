// Herdr plugin actions: listing and running, on the relevant machine.
// Everything goes through Herdr's API socket (local, or remote socket forwarded over
// SSH, see machines.ts) as JSON: no shell, no interpolation. Herdr runs
// the manifest's argv command itself, in the background; we follow its log
// (plugin.log.list) for a few seconds to give the result.
// herdr-projects 1.x has its own page (the Board, server/utils/projectsTasks.ts):
// its actions here are Herdr's like any plugin's.
import type { PluginAction, PluginActionResult } from '../../shared/types'
import { splitId } from '../../shared/ids'
import { log } from './env'
import { getState } from './state'
import { HerdrError, herdrOn, sleep } from './herdr'
import { findPane } from './state'
import { machineFor } from './actions'
import { ACTION_ID_RE, PLUGIN_ID_RE, type RawPlugin, type RawPluginAction, type RawPluginLog, actionContext, logResult, normalizeActions } from './pluginPolicy'

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

export async function invokePluginAction(body: { machine?: unknown, pane_id?: unknown, plugin?: unknown, action?: unknown, input?: unknown, lang?: unknown }): Promise<PluginActionResult> {
  const plugin = String(body.plugin || '')
  const action = String(body.action || '')
  if (!PLUGIN_ID_RE.test(plugin) || !ACTION_ID_RE.test(action)) throw new HerdrError('bad_action', 'Invalid action')
  // Machine: the pane's if there is one (an agent's menu), otherwise the requested one.
  const paneId = body.pane_id ? String(body.pane_id) : ''
  const pane = paneId ? findPane(paneId) : null
  if (paneId && !pane) throw new HerdrError('bad_pane', 'Pane not found')
  const m = machineFor(pane ? splitId(pane.id).machine : body.machine)
  // Only an action that Herdr announces, at the expected place.
  const known = (await listPluginActions(m.key, true)).find(a => a.plugin === plugin && a.id === action)
  if (!known) throw new HerdrError('plugin_action_not_found', 'Action not found on this machine')
  if (pane ? !known.agent : !known.machine) throw new HerdrError('bad_context', 'Action not available here')

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
  log(`plugin ${plugin}.${action}: ${res.status}${res.exitCode !== null ? ` (${res.exitCode})` : ''}`)
  return res
}
