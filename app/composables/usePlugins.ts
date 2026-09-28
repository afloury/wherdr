// Actions des plugins Herdr (herdr-plugin.toml) : menu d'un agent (actions
// workspace / tab / pane, lancées avec le pane de l'agent) et menu de la machine
// (actions globales). Liste gardée par machine, relue au plus toutes les 30 s.
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
export const pluginFormState = reactive<{
  open: boolean, action: PluginAction | null, target: Target | null,
  name: string, goal: string, task: string, slug: string, repo: string,
  // « New project » : machine du dépôt (clé wherdr) ; nom encore proposé par
  // l'app (suit le dépôt tant que l'utilisateur ne l'a pas tapé) ; état du
  // dépôt choisi d'après /api/gitroot, et sa racine Git.
  machine: string, nameAuto: boolean, repoState: 'idle' | 'checking' | RepoState, repoRoot: string,
  // Adoption : conversation du pane sans message (true), avec (false), inconnue (null).
  empty: boolean | null, busy: boolean,
}>({
  open: false, action: null, target: null, name: '', goal: '', task: '', slug: '', repo: '',
  machine: '', nameAuto: true, repoState: 'idle', repoRoot: '', empty: null, busy: false,
})
export function closePluginForm() { if (!pluginFormState.busy) pluginFormState.open = false }
// Machine où tourne la commande herdr-projects (celle du projet).
export const pluginTargetMachine = (target: Target | null) => (!target ? '' : 'pane' in target ? target.pane.machine || '' : target.machine)

// Champs à remplir avant « Exécuter » ; nom de projet valide ; dépôt choisi
// vérifié (un dépôt Git, pas un sous-dossier ni le HOME).
export function pluginFormValid(): boolean {
  const f = pluginFormState
  const id = f.action?.id || ''
  const need = PROJECT_REQUIRED[id] || []
  const s = f as unknown as Record<string, string>
  if (!need.every(k => String(s[k] || '').trim())) return false
  if ((id === 'new' || id === 'adopt-workspace') && !projectNameOk(f.name)) return false
  return id !== 'new' || !f.repo.trim() || f.repoState === 'repo'
}

// Dossier du dépôt de « New project » : vérifié par /api/gitroot sur sa machine ;
// le nom proposé suit le dépôt tant que l'utilisateur ne l'a pas tapé.
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
  // Sous-dossier : le nom du dépôt (sa racine), pas celui du sous-dossier.
  if (f.nameAuto) f.name = suggestedProjectName('new', { repo: f.repoState === 'none' ? '' : f.repoRoot })
}
export function setPluginFormName(v: string) {
  pluginFormState.name = v
  // Champ vidé : l'app propose de nouveau le nom du dépôt.
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

// Conversation vide : proposer « New project » à la place de l'adoption.
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
  // Même feuille que « New project » ouvert depuis le menu : dépôt proposé,
  // nom tiré du dépôt tant que l'utilisateur n'en a pas tapé un.
  loadConfig()
  checkPluginRepo()
  if (pluginFormState.target) prepareForm(pluginFormState.target, 'new')
}

// Résultat qui reste à l'écran : « Check setup » (en-tête et sortie entière) et
// « Configure » (rappel de recharger la config du client Herdr).
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
    // Racine du dépôt Git du space courant, proposée pour « New project » ;
    // rien hors d'un dépôt (ni pour le HOME lui-même, filtré par le serveur).
    // Jamais le dossier du space tel quel : seulement ce que /api/gitroot rend.
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
const machineLabelOf = (key: string) => machineName(key) || hostLabel.value || t('cette machine')

async function runPluginAction(a: PluginAction, target: Target) {
  const where = 'pane' in target
    ? tl(`pour « ${paneTitle(target.pane)} »`, `for “${paneTitle(target.pane)}”`)
    : tl(`sur ${machineLabelOf(target.machine)}`, `on ${machineLabelOf(target.machine)}`)
  // Toasts : « Projects · Pause project » (le libellé seul ne dit pas quel plugin).
  const name = a.label === a.title ? a.title : `${a.pluginName} · ${a.label}`
  // Saisie d'abord : la feuille, avec son bouton Exécuter, vaut confirmation.
  if (a.plugin === 'herdr-projects' && ['new', 'adopt-workspace', 'open', 'pause', 'resume'].includes(a.id)) {
    // Nom proposé : le libellé du space pour l'adoption s'il fait un nom valide
    // (pas « ~ » ni un chemin) ; pour « New project », celui du dépôt choisi.
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
      tl(`Lancer « ${a.label} » (${a.pluginName}) ${where} ? Le plugin exécute sa commande sur la machine.`,
        `Run “${a.label}” (${a.pluginName}) ${where}? The plugin runs its command on the machine.`),
      t('Exécuter'), 'primary',
    )
    if (!ok) return
  }
  await executePluginAction(a, target)
}

async function executePluginAction(a: PluginAction, target: Target, input?: Record<string, string>) {
  const name = a.label === a.title ? a.title : `${a.pluginName} · ${a.label}`
  haptic()
  toast(tl(`${name} : en cours…`, `${name}: running…`))
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
    // Le client Herdr ne relit pas sa config tout seul : rappel qui reste affiché.
    if (a.plugin === 'herdr-projects' && a.id === 'configure' && r.status !== 'failed') {
      showPluginResult(a.label, r, true)
      return true
    }
    if (r.status === 'failed') {
      const code = r.exitCode !== null ? tl(` (code ${r.exitCode})`, ` (exit ${r.exitCode})`) : ''
      toast(tl(`${name} : échec${code}`, `${name}: failed${code}`), true, r.output)
      return false
    } else if (r.status === 'running') {
      toast(tl(`${name} : continue en arrière-plan`, `${name}: still running in the background`), false, r.output)
    } else {
      toast(`✓ ${name}`, false, r.output)
    }
    return true
  } catch (err) { toast((err as Error).message, true); return false }
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
