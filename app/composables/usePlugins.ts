// Herdr plugin actions (herdr-plugin.toml): an agent's menu (workspace /
// tab / pane actions, run with the agent's pane) and the machine's menu
// (global actions). List kept per machine, re-read at most every 30 s.
import type { ChatResponse, Pane, PluginAction, PluginActionList, PluginActionResult } from '#shared/types'
import { PROJECT_REQUIRED, type RepoState, conversationEmpty, projectNameOk, repoState, suggestedProjectName } from '#shared/projectsActions'

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
export const pluginFormState = reactive<{
  open: boolean, action: PluginAction | null, target: Target | null,
  name: string, goal: string, task: string, slug: string, repo: string,
  // "New project": machine of the repository (wherdr key); name still suggested by
  // the app (follows the repository as long as the user has not typed it); state of the
  // chosen repository according to /api/gitroot, and its Git root.
  machine: string, nameAuto: boolean, repoState: 'idle' | 'checking' | RepoState, repoRoot: string,
  // Adoption: pane conversation without a message (true), with (false), unknown (null).
  empty: boolean | null, busy: boolean,
}>({
  open: false, action: null, target: null, name: '', goal: '', task: '', slug: '', repo: '',
  machine: '', nameAuto: true, repoState: 'idle', repoRoot: '', empty: null, busy: false,
})
export function closePluginForm() { if (!pluginFormState.busy) pluginFormState.open = false }
// Machine where the herdr-projects command runs (the project's).
export const pluginTargetMachine = (target: Target | null) => (!target ? '' : 'pane' in target ? target.pane.machine || '' : target.machine)

// Fields to fill in before "Run"; valid project name; chosen repository
// checked (a Git repository, not a subfolder nor HOME).
export function pluginFormValid(): boolean {
  const f = pluginFormState
  const id = f.action?.id || ''
  const need = PROJECT_REQUIRED[id] || []
  const s = f as unknown as Record<string, string>
  if (!need.every(k => String(s[k] || '').trim())) return false
  if ((id === 'new' || id === 'adopt-workspace') && !projectNameOk(f.name)) return false
  return id !== 'new' || !f.repo.trim() || f.repoState === 'repo'
}

// Repository folder of "New project": checked by /api/gitroot on its machine;
// the suggested name follows the repository as long as the user has not typed it.
let repoCheck = 0
export async function checkPluginRepo() {
  const f = pluginFormState
  const repo = f.repo.trim()
  const n = ++repoCheck
  if (!repo) {
    Object.assign(f, { repoState: 'idle', repoRoot: '' })
    if (f.nameAuto) f.name = ''
    return
  }
  f.repoState = 'checking'
  const r = await api<{ root: string | null }>(`/api/gitroot?machine=${encodeURIComponent(f.machine)}&path=${encodeURIComponent(repo)}`).catch(() => null)
  if (n !== repoCheck) return
  f.repoRoot = r?.root || ''
  f.repoState = repoState(repo, r?.root)
  // Subfolder: the repository's name (its root), not the subfolder's.
  if (f.nameAuto) f.name = suggestedProjectName('new', { repo: f.repoState === 'none' ? '' : f.repoRoot })
}
export function setPluginFormName(v: string) {
  pluginFormState.name = v
  // Field emptied: the app suggests the repository name again.
  pluginFormState.nameAuto = !v.trim()
}
export function setPluginRepoMachine(key: string) {
  if (pluginFormState.machine === key) return
  pluginFormState.machine = key
  pluginFormState.repo = ''
  checkPluginRepo()
}
export async function submitPluginForm() {
  const { action, target } = pluginFormState
  if (!action || !target || pluginFormState.busy || !pluginFormValid()) return
  const f = pluginFormState
  const input: Record<string, string> = action.id === 'new'
    ? { name: f.name.trim(), goal: f.goal.trim(), repo: f.repo.trim(), ...(f.repo.trim() ? { machine: f.machine } : {}) }
    : action.id === 'adopt-workspace'
      ? { name: f.name.trim(), goal: f.goal.trim(), task: f.task.trim() }
      : { slug: f.slug.trim() }
  pluginFormState.busy = true
  try { if (await executePluginAction(action, target, input)) pluginFormState.open = false }
  finally { pluginFormState.busy = false }
}

// Empty conversation: offer "New project" instead of adoption.
export function newProjectAction(): PluginAction | null {
  const t = pluginFormState.target
  if (!t || !('pane' in t)) return null
  return agentPluginActions(t.pane.machine).find(a => a.plugin === 'herdr-projects' && a.id === 'new') || null
}
export function switchToNewProject() {
  const a = newProjectAction()
  if (!a || pluginFormState.busy) return
  pluginFormState.action = a
  pluginFormState.empty = null
  // Same sheet as "New project" opened from the menu: suggested repository,
  // name taken from the repository as long as the user has not typed one.
  loadConfig()
  checkPluginRepo()
  if (pluginFormState.target) prepareForm(pluginFormState.target, 'new')
}

// Result that stays on screen: "Check setup" (header and full output) and
// "Configure" (reminder to reload the Herdr client config).
export const pluginResultState = reactive<{
  open: boolean, title: string, result: PluginActionResult | null, reload: boolean,
}>({ open: false, title: '', result: null, reload: false })
export function showPluginResult(title: string, result: PluginActionResult, reload = false) {
  clearToast()
  Object.assign(pluginResultState, { open: true, title, result, reload })
}

async function prepareForm(target: Target, action: string) {
  if (!('pane' in target)) return
  const pane = target.pane
  if (action === 'adopt-workspace') {
    const r = await api<ChatResponse>(`/api/chat?pane=${encodeURIComponent(pane.id)}`).catch(() => null)
    if (toRaw(pluginFormState.target) === target) pluginFormState.empty = conversationEmpty(r)
  }
  if (action === 'new') {
    // Git repository root of the current space, suggested for "New project";
    // nothing outside a repository (nor for HOME itself, filtered by the server).
    // Never the space folder as is: only what /api/gitroot returns.
    if (!pane.cwd) return
    const machine = pane.machine || ''
    const r = await api<{ root: string | null }>(`/api/gitroot?machine=${encodeURIComponent(machine)}&path=${encodeURIComponent(pane.cwd)}`).catch(() => null)
    const f = pluginFormState
    if (toRaw(f.target) === target && r?.root && shortPath(r.root) !== '~' && !f.repo && f.machine === machine) {
      f.repo = r.root
      checkPluginRepo()
    }
  }
}
// Nom de la machine ; une seule : HOST_LABEL.
const machineLabelOf = (key: string) => machineName(key) || hostLabel.value || t('this machine')

async function runPluginAction(a: PluginAction, target: Target) {
  const where = 'pane' in target
    ? tl(`for “${paneTitle(target.pane)}”`, `pour « ${paneTitle(target.pane)} »`)
    : tl(`on ${machineLabelOf(target.machine)}`, `sur ${machineLabelOf(target.machine)}`)
  // Toasts : « Projects · Pause project » (le libellé seul ne dit pas quel plugin).
  const name = a.label === a.title ? a.title : `${a.pluginName} · ${a.label}`
  // Input first: the sheet, with its Run button, counts as confirmation.
  if (a.plugin === 'herdr-projects' && ['new', 'adopt-workspace', 'open', 'pause', 'resume'].includes(a.id)) {
    // Suggested name: the space label for adoption if it makes a valid name
    // (not "~" nor a path); for "New project", that of the chosen repository.
    const space = 'pane' in target ? herdrState.value.workspaces.find(w => w.id === target.pane.workspace)?.label || '' : ''
    Object.assign(pluginFormState, {
      action: a, target,
      name: a.id === 'adopt-workspace' ? suggestedProjectName(a.id, { space }) : '',
      nameAuto: true, machine: pluginTargetMachine(target), repoState: 'idle', repoRoot: '',
      goal: '', task: '', repo: '', empty: null,
      slug: 'pane' in target ? target.pane.project || '' : '',
      open: true,
    })
    if (a.id === 'new') loadConfig()
    prepareForm(target, a.id)
    return
  }
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

async function executePluginAction(a: PluginAction, target: Target, input?: Record<string, string>) {
  const name = a.label === a.title ? a.title : `${a.pluginName} · ${a.label}`
  haptic()
  toast(tl(`${name}: running…`, `${name} : en cours…`))
  try {
    const r = await api<PluginActionResult>('/api/plugins/invoke', {
      plugin: a.plugin, action: a.id, lang: language === 'en' ? 'en' : 'fr',
      ...(input ? { input } : {}),
      ...('pane' in target ? { pane_id: target.pane.id } : { machine: target.machine }),
    })
    if (a.plugin === 'herdr-projects' && a.id === 'doctor' && r.setup) {
      showPluginResult(a.label, r)
      return r.status !== 'running'
    }
    // The Herdr client does not re-read its config on its own: reminder that stays shown.
    if (a.plugin === 'herdr-projects' && a.id === 'configure' && r.status !== 'failed') {
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
    items.push({
      label: a.label, desc: a.description || undefined,
      icon: a.confirm ? 'i-lucide-play' : 'i-lucide-eye',
      run: () => { runPluginAction(a, target) },
    })
  }
  const title = 'pane' in target
    ? (plugins.size === 1 ? [...plugins][0]! : t('Plugin actions'))
    : `Plugins · ${machineLabelOf(machine)}`
  openMenu(items, title)
}
