// Actions des plugins Herdr : ce que wherdr en garde et où il les propose
// (fonctions pures, testées dans tests/plugins.test.ts).
//
// Herdr (plugin.action.list) donne pour chaque action ses contextes :
//  - workspace / tab / pane : l'action porte sur l'endroit d'où on la lance ;
//    wherdr la met dans le menu « … » d'un agent et lui passe son pane, son
//    onglet et son workspace ;
//  - global (ou aucun contexte déclaré) : l'action vaut pour toute la machine ;
//    wherdr la met dans le menu de la machine (accueil) ;
//  - selection seulement : il faut du texte sélectionné dans le terminal, ce
//    que wherdr n'a pas : écartée.
import type { PluginAction, PluginActionResult } from '../../shared/types'
import type { Pane, Workspace } from '../../shared/types'

export interface RawPluginAction {
  plugin_id?: string
  action_id?: string
  title?: string
  description?: string | null
  contexts?: string[] | null
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

// Identifiants acceptés par Herdr (cf. doc des plugins) : on ne relaie rien d'autre.
export const PLUGIN_ID_RE = /^[A-Za-z0-9.:_-]{1,100}$/
export const ACTION_ID_RE = /^[A-Za-z0-9:_-]{1,100}$/

// Binaire herdr-projects sur une machine distante : `$1` = binaire herdr (à
// exporter, sinon le plugin ne le voit pas), `$2` = binaire du plugin, puis ses arguments.
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

// Actions qui ne font que montrer ou vérifier : pas de confirmation. Toutes les
// autres (un plugin exécute ce qu'il veut) en demandent une.
const READ_ONLY = /\b(list|lists|show|status|view|info|doctor|check|help|preview|inspect|lister|liste|voir|afficher|état|etat|vérifier|verifier|aide)\b/i
export function needsConfirm(a: { id: string, title: string }): boolean {
  return !(READ_ONLY.test(a.id.replace(/[_:]/g, '-')) || READ_ONLY.test(a.title))
}

// Libellé sous l'en-tête du plugin : sans son nom en préfixe (« Projects: pause
// project » -> « Pause project »), le titre entier s'il ne reste rien.
export function shortLabel(title: string, pluginName: string): string {
  const esc = pluginName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const rest = title.replace(new RegExp(`^${esc}\\s*[:·—–-]\\s*`, 'i'), '').trim()
  return rest ? rest[0]!.toUpperCase() + rest.slice(1) : title
}

export function normalizeActions(actions: RawPluginAction[], plugins: RawPlugin[] = []): PluginAction[] {
  const byId = new Map(plugins.filter(p => p && p.plugin_id).map(p => [p.plugin_id!, p]))
  const out: PluginAction[] = []
  for (const a of actions || []) {
    const plugin = String(a?.plugin_id || '')
    const id = String(a?.action_id || '')
    if (!PLUGIN_ID_RE.test(plugin) || !ACTION_ID_RE.test(id)) continue
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
      agent, machine, confirm: needsConfirm({ id, title }),
    })
  }
  // Groupés par plugin, par ordre alphabétique des libellés (Herdr ne donne pas
  // l'ordre du manifeste : plugin.list et plugin.action.list trient par identifiant).
  return out.sort((x, y) => x.pluginName.localeCompare(y.pluginName) || x.label.localeCompare(y.label))
}

// Fin de sortie lisible dans un toast : dernières lignes non vides, sans
// séquences ANSI ni caractères de contrôle.
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
