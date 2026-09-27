// Actions des plugins Herdr (herdr-plugin.toml) : menu d'un agent (actions
// workspace / tab / pane, lancées avec le pane de l'agent) et menu de la machine
// (actions globales). Liste gardée par machine, relue au plus toutes les 30 s.
import type { Pane, PluginAction, PluginActionList, PluginActionResult } from '#shared/types'

const REFRESH_MS = 30000
export const pluginActions = ref<Record<string, PluginAction[]>>({})
const loadedAt = new Map<string, number>()
const loading = new Map<string, Promise<void>>()

export function loadPluginActions(machine: string, force = false): Promise<void> {
  const key = machine || ''
  const at = loadedAt.get(key)
  if (!force && at && Date.now() - at < REFRESH_MS) return Promise.resolve()
  const pending = loading.get(key)
  if (pending) return pending
  const p = api<PluginActionList>(`/api/plugins/actions?machine=${encodeURIComponent(key)}`)
    .then((r) => {
      pluginActions.value = { ...pluginActions.value, [key]: r.actions || [] }
      loadedAt.set(key, Date.now())
    })
    .catch(() => { /* Herdr injoignable : pas d'entrée de menu */ })
    .finally(() => loading.delete(key))
  loading.set(key, p)
  return p
}

export const agentPluginActions = (machine: string | null | undefined) =>
  (pluginActions.value[machine || ''] || []).filter(a => a.agent)
export const machinePluginActions = (machine: string | null | undefined) =>
  (pluginActions.value[machine || ''] || []).filter(a => a.machine)

type Target = { pane: Pane } | { machine: string }
// Nom de la machine ; une seule : HOST_LABEL.
const machineLabelOf = (key: string) => machineName(key) || hostLabel.value || t('cette machine')

async function runPluginAction(a: PluginAction, target: Target) {
  const where = 'pane' in target
    ? tl(`pour « ${paneTitle(target.pane)} »`, `for “${paneTitle(target.pane)}”`)
    : tl(`sur ${machineLabelOf(target.machine)}`, `on ${machineLabelOf(target.machine)}`)
  // Toasts : « Projects · Pause project » (le libellé seul ne dit pas quel plugin).
  const name = a.label === a.title ? a.title : `${a.pluginName} · ${a.label}`
  if (a.confirm) {
    const ok = await askConfirm(
      tl(`Lancer « ${a.label} » (${a.pluginName}) ${where} ? Le plugin exécute sa commande sur la machine.`,
        `Run “${a.label}” (${a.pluginName}) ${where}? The plugin runs its command on the machine.`),
      t('Exécuter'), 'primary',
    )
    if (!ok) return
  }
  haptic()
  toast(tl(`${name} : en cours…`, `${name}: running…`))
  try {
    const r = await api<PluginActionResult>('/api/plugins/invoke', {
      plugin: a.plugin, action: a.id,
      ...('pane' in target ? { pane_id: target.pane.id } : { machine: target.machine }),
    })
    if (r.status === 'failed') {
      const code = r.exitCode !== null ? tl(` (code ${r.exitCode})`, ` (exit ${r.exitCode})`) : ''
      toast(tl(`${name} : échec${code}`, `${name}: failed${code}`), true, r.output)
    } else if (r.status === 'running') {
      toast(tl(`${name} : continue en arrière-plan`, `${name}: still running in the background`), false, r.output)
    } else {
      toast(`✓ ${name}`, false, r.output)
    }
  } catch (err) { toast((err as Error).message, true) }
}

// Menu des actions : groupes par plugin, description sous le libellé.
export function openPluginMenu(target: Target) {
  const machine = 'pane' in target ? target.pane.machine || '' : target.machine
  const list = 'pane' in target ? agentPluginActions(machine) : machinePluginActions(machine)
  const items: MenuItem[] = []
  const plugins = new Set(list.map(a => a.pluginName))
  let group = ''
  for (const a of list) {
    if (plugins.size > 1 && a.pluginName !== group) {
      group = a.pluginName
      items.push({ kind: 'group', label: group })
    }
    items.push({
      label: a.label, desc: a.description || undefined,
      icon: a.confirm ? 'i-lucide-play' : 'i-lucide-eye',
      run: () => { runPluginAction(a, target) },
    })
  }
  const title = 'pane' in target
    ? (plugins.size === 1 ? [...plugins][0]! : t('Actions des plugins'))
    : `Plugins · ${machineLabelOf(machine)}`
  openMenu(items, title)
}
