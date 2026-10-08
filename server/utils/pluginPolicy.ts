// Herdr plugin actions: what wherdr keeps of them and where it offers them
// (pure functions, tested in tests/plugins.test.ts).
//
// Herdr (plugin.action.list) gives the contexts of each action:
//  - workspace / tab / pane: the action applies to where it is launched from;
//    wherdr puts it in an agent's "…" menu and passes it its pane, its
//    tab and its workspace;
//  - global (or no declared context): the action applies to the whole machine;
//    wherdr puts it in the machine's menu (home);
//  - selection only: it needs text selected in the terminal, which
//    wherdr does not have: dropped.
import type { PluginAction, PluginActionResult } from '../../shared/types'
import type { Pane, Workspace } from '../../shared/types'

export interface RawPluginAction {
  plugin_id?: string
  action_id?: string
  title?: string
  description?: string | null
  contexts?: string[] | null
  command?: unknown
  placement?: string | null
}
export interface RawPlugin { plugin_id?: string, name?: string, enabled?: boolean }
export interface RawPluginLog {
  log_id?: string
  status?: string
  exit_code?: number | null
  stdout?: string | null
  stderr?: string | null
  error?: string | null
}

// Identifiers accepted by Herdr (see the plugin docs): we relay nothing else.
export const PLUGIN_ID_RE = /^[A-Za-z0-9.:_-]{1,100}$/
export const ACTION_ID_RE = /^[A-Za-z0-9:_-]{1,100}$/

// herdr-projects binary on a remote machine: `$1` = herdr binary (to
// export, otherwise the plugin does not see it), `$2` = plugin binary, then its arguments.
export const REMOTE_PROJECTS_SCRIPT = 'export HERDR_BIN_PATH="$1"; shift; bin="$1"; shift; exec "$bin" "$@"'

export function actionContext(pane: Pane | null, workspaces: Workspace[] = []): Record<string, string> {
  const context: Record<string, string> = { invocation_source: 'wherdr' }
  if (!pane) return context
  const local = (id: string) => id.includes('~') ? id.slice(id.indexOf('~') + 1) : id
  const workspace = workspaces.find(w => w.id === pane.workspace)
  return {
    ...context,
    focused_pane_id: local(pane.id), tab_id: local(pane.tab), workspace_id: local(pane.workspace),
    workspace_label: workspace?.label || '', workspace_cwd: pane.cwd || '', focused_pane_cwd: pane.cwd || '',
  }
}

const AGENT_CONTEXTS = ['workspace', 'tab', 'pane']

// Actions that only show or check: no confirmation. All the
// others (a plugin runs whatever it wants) ask for one.
const READ_ONLY = /\b(list|lists|show|status|view|info|doctor|check|help|preview|inspect|lister|liste|voir|afficher|état|etat|vérifier|verifier|aide)\b/i
export function needsConfirm(a: { id: string, title: string }): boolean {
  return !(READ_ONLY.test(a.id.replace(/[_:]/g, '-')) || READ_ONLY.test(a.title))
}

// Label under the plugin header: without its name as prefix ("Projects: pause
// project" -> "Pause project"), the whole title if nothing is left.
export function shortLabel(title: string, pluginName: string): string {
  const esc = pluginName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const rest = title.replace(new RegExp(`^${esc}\\s*[:·—–-]\\s*`, 'i'), '').trim()
  return rest ? rest[0]!.toUpperCase() + rest.slice(1) : title
}

// wherdr's own Herdr plugin (`<owner>.wherdr`, also in forks): its actions (panel,
// open in the browser) only make sense from Herdr; run from wherdr they go round in circles.
export const isOwnPlugin = (id: string) => id === 'wherdr' || id.endsWith('.wherdr')

// Actions whose result shows up in Herdr itself (a plugin pane, popup or overlay),
// not in wherdr: declared placement, a `plugin pane open` command, or a
// "popup" action id (herdr-projects' open-popup).
export function opensInHerdr(a: RawPluginAction): boolean {
  if (a.placement === 'popup' || a.placement === 'overlay') return true
  const cmd = Array.isArray(a.command) ? a.command.map(String).join(' ') : ''
  if (/\bplugin\s+pane\s+open\b/.test(cmd)) return true
  return /(^|[-_:])popup($|[-_:])/i.test(String(a.action_id || ''))
}

export function normalizeActions(actions: RawPluginAction[], plugins: RawPlugin[] = []): PluginAction[] {
  const byId = new Map(plugins.filter(p => p && p.plugin_id).map(p => [p.plugin_id!, p]))
  const out: PluginAction[] = []
  for (const a of actions || []) {
    const plugin = String(a?.plugin_id || '')
    const id = String(a?.action_id || '')
    if (!PLUGIN_ID_RE.test(plugin) || !ACTION_ID_RE.test(id) || isOwnPlugin(plugin)) continue
    const p = byId.get(plugin)
    if (p && p.enabled === false) continue
    const ctx = (Array.isArray(a.contexts) ? a.contexts : []).map(String)
    const agent = ctx.some(c => AGENT_CONTEXTS.includes(c))
    const machine = !ctx.length || ctx.includes('global')
    if (!agent && !machine) continue
    const title = String(a.title || id).replace(/\s+/g, ' ').trim().slice(0, 120) || id
    const description = a.description ? String(a.description).replace(/\s+/g, ' ').trim().slice(0, 240) || null : null
    const pluginName = String(p?.name || plugin).trim() || plugin
    out.push({
      plugin, pluginName, id, title, label: shortLabel(title, pluginName), description,
      agent, machine, confirm: needsConfirm({ id, title }), inHerdr: opensInHerdr(a),
    })
  }
  // Grouped by plugin, in alphabetical order of labels (Herdr does not give
  // the manifest order: plugin.list and plugin.action.list sort by identifier).
  return out.sort((x, y) => x.pluginName.localeCompare(y.pluginName) || x.label.localeCompare(y.label))
}

// End of output readable in a toast: last non-empty lines, without
// ANSI sequences or control characters.
const ANSI = /\x1B(?:\[[0-?]*[ -/]*[@-~]|\][^\x07\x1B]*(?:\x07|\x1B\\)|[@-Z\\-_])/g
export function stripAnsi(text: string | null | undefined): string {
  return String(text || '')
    .replace(ANSI, '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x08\x0B-\x1F\x7F]/g, '')
}
export function outputTail(text: string | null | undefined, max = 300): string {
  const lines = stripAnsi(text)
    .split('\n').map(l => l.trim()).filter(Boolean)
  let out = ''
  for (let i = lines.length - 1; i >= 0; i--) {
    const next = out ? `${lines[i]}\n${out}` : lines[i]!
    if (next.length > max) {
      if (!out) out = '…' + lines[i]!.slice(-(max - 1))
      break
    }
    out = next
  }
  return out
}

export function logResult(log: RawPluginLog | null | undefined): PluginActionResult {
  const status = log?.status === 'succeeded' || log?.status === 'failed' ? log.status : 'running'
  const exitCode = typeof log?.exit_code === 'number' ? log.exit_code : null
  const output = status === 'failed'
    ? outputTail(log?.stderr) || outputTail(log?.error) || outputTail(log?.stdout)
    : outputTail(log?.stdout) || outputTail(log?.stderr)
  return { status, exitCode, output }
}
