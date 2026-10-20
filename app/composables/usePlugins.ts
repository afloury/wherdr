// Herdr plugin actions (herdr-plugin.toml): an agent's menu (workspace /
// tab / pane actions, run with the agent's pane) and the machine's menu
// (global actions). List kept per machine, re-read at most every 30 s.
// herdr-projects 1.x has its own page, the Board (BoardView); its actions
// here are Herdr's like any plugin's.
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
    .catch(() => { /* Herdr unreachable: no menu entry */ })
    .finally(() => loading.delete(key))
  loading.set(key, p)
  return p
}

export const agentPluginActions = (machine: string | null | undefined) =>
  (pluginActions.value[machine || ''] || []).filter(a => a.agent)
export const machinePluginActions = (machine: string | null | undefined) =>
  (pluginActions.value[machine || ''] || []).filter(a => a.machine)

type Target = { pane: Pane } | { machine: string }

// Result that stays on screen: a plugin's "Configure" (reminder to reload the
// Herdr client config).
export const pluginResultState = reactive<{
  open: boolean, title: string, result: PluginActionResult | null, reload: boolean,
}>({ open: false, title: '', result: null, reload: false })
export function showPluginResult(title: string, result: PluginActionResult, reload = false) {
  clearToast()
  Object.assign(pluginResultState, { open: true, title, result, reload })
}

// Machine name; a single one: HOST_LABEL.
const machineLabelOf = (key: string) => machineName(key) || hostLabel.value || t('this machine')

async function runPluginAction(a: PluginAction, target: Target) {
  const where = 'pane' in target
    ? tl(`for “${paneTitle(target.pane)}”`, `pour « ${paneTitle(target.pane)} »`)
    : tl(`on ${machineLabelOf(target.machine)}`, `sur ${machineLabelOf(target.machine)}`)
  if (a.confirm) {
    const ok = await askConfirm(
      tl(`Run “${a.label}” (${a.pluginName}) ${where}? The plugin runs its command on the machine.`,
        `Lancer « ${a.label} » (${a.pluginName}) ${where} ? Le plugin exécute sa commande sur la machine.`),
      t('Run'), 'primary',
    )
    if (!ok) return
  }
  await executePluginAction(a, target)
}

async function executePluginAction(a: PluginAction, target: Target) {
  const name = a.label === a.title ? a.title : `${a.pluginName} · ${a.label}`
  haptic()
  toast(tl(`${name}: running…`, `${name} : en cours…`))
  try {
    const r = await api<PluginActionResult>('/api/plugins/invoke', {
      plugin: a.plugin, action: a.id, lang: language === 'en' ? 'en' : 'fr',
      ...('pane' in target ? { pane_id: target.pane.id } : { machine: target.machine }),
    })
    // The Herdr client does not re-read its config on its own: reminder that stays shown.
    if (a.id === 'configure' && r.status !== 'failed') {
      showPluginResult(a.label, r, true)
      return true
    }
    if (r.status === 'failed') {
      const code = r.exitCode !== null ? tl(` (exit ${r.exitCode})`, ` (code ${r.exitCode})`) : ''
      toast(tl(`${name}: failed${code}`, `${name} : échec${code}`), true, r.output)
      return false
    } else if (r.status === 'running') {
      toast(tl(`${name}: still running in the background`, `${name} : continue en arrière-plan`), false, r.output)
    } else {
      toast(`✓ ${name}`, false, r.output)
    }
    return true
  } catch (err) { toast((err as Error).message, true); return false }
}

// Action menu: groups per plugin, description under the label.
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
    // Its pane or popup shows up in Herdr (on the computer), not here: said under the label.
    const where = a.inHerdr ? t('Opens in Herdr') : ''
    items.push({
      label: a.label, desc: [where, a.description].filter(Boolean).join(' · ') || undefined,
      icon: a.inHerdr ? 'i-lucide-monitor' : a.confirm ? 'i-lucide-play' : 'i-lucide-eye',
      run: () => { runPluginAction(a, target) },
    })
  }
  const title = 'pane' in target
    ? (plugins.size === 1 ? [...plugins][0]! : t('Plugin actions'))
    : `Plugins · ${machineLabelOf(machine)}`
  openMenu(items, title)
}
