// Actions de herdr-projects lancées depuis wherdr en ligne de commande : saisies
// attendues et argv (fonctions pures, testées dans tests/projectsActions.test.ts).
// Options vérifiées sur herdr-projects 0.2.30 (`<commande> --help`) :
//  - adopt-workspace --name --pane --workspace-cwd --goal --session (pas d'option
//    pour la tâche en cours : elle rejoint l'objectif) ;
//  - new <nom> --goal --repo <PATH[@MACHINE]> (MACHINE : id ou libellé d'une
//    machine de `herdr machine list`, lettres, chiffres, « - _ . » seulement) ;
//  - open / pause / resume <slug>, doctor --session.
import type { ChatResponse } from './types'

export const PROJECT_INPUTS: Record<string, string[]> = {
  new: ['name'], 'adopt-workspace': ['name'], open: ['slug'], pause: ['slug'], resume: ['slug'],
}
// Saisies facultatives, en plus des champs ci-dessus. L'objectif l'est aussi :
// herdr-projects ne l'exige pas et un projet continu n'a pas de cap figé.
// `machine` : clé wherdr de la machine du dépôt (absente = celle du projet).
export const PROJECT_OPTIONAL: Record<string, string[]> = { new: ['goal', 'repo', 'machine'], 'adopt-workspace': ['goal', 'task'] }
// Champs à remplir : nom (ou slug).
export const PROJECT_REQUIRED: Record<string, string[]> = {
  new: ['name'], 'adopt-workspace': ['name'], open: ['slug'], pause: ['slug'], resume: ['slug'],
}
export const INPUT_MAX: Record<string, number> = { name: 120, slug: 120, goal: 400, task: 400, repo: 1024, machine: 64 }

export type ProjectInput = Partial<Record<'name' | 'goal' | 'task' | 'slug' | 'repo' | 'machine', string>>

// Saisie nettoyée, ou null si un champ manque ou déborde.
export function cleanProjectInput(action: string, raw: unknown): ProjectInput | null {
  const fields = PROJECT_INPUTS[action]
  if (!fields) return null
  const input = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {}
  const out: ProjectInput = {}
  for (const key of [...fields, ...(PROJECT_OPTIONAL[action] || [])]) {
    const v = input[key]
    if (v === undefined && !fields.includes(key)) continue
    if (typeof v !== 'string') return null
    const s = v.replace(/\s+/g, ' ').trim()
    if (s.length > (INPUT_MAX[key] || 120)) return null
    // Nom ou slug passés en argument : « -… » serait lu comme une option.
    if ((key === 'name' || key === 'slug') && s.startsWith('-')) return null
    if (s) out[key as keyof ProjectInput] = s
  }
  // Le serveur applique la même règle de nom que le formulaire.
  if (out.name && !projectNameOk(out.name)) return null
  return (PROJECT_REQUIRED[action] || []).every(k => out[k as keyof ProjectInput]) ? out : null
}

// Nom de projet accepté par herdr-projects (`slug_from_name`) : ni « / », ni
// « \ », ni « .. », et au moins une lettre ou un chiffre ASCII pour le slug.
// « ~ » (libellé d'un space ouvert dans le HOME) ou un chemin n'en sont pas.
export function projectNameOk(name: string | null | undefined): boolean {
  const s = (name || '').trim()
  return Boolean(s) && !/[/\\]|\.\./.test(s) && /[a-z0-9]/i.test(s)
}

// Nom proposé : « New project » prend le nom du dossier du dépôt choisi (rien
// sans dépôt) ; l'adoption, le libellé du space. Jamais un nom refusé.
export function suggestedProjectName(action: string, o: { repo?: string | null, space?: string | null }): string {
  const name = action === 'new'
    ? (o.repo || '').replace(/\/+$/, '').split('/').pop() || ''
    : (o.space || '').trim()
  return projectNameOk(name) ? name : ''
}

// Où en est le dossier choisi comme dépôt, d'après /api/gitroot (racine Git
// proposée, ou null) : le dépôt lui-même, un sous-dossier du dépôt `root`, ou
// rien d'utilisable (hors dépôt, ou le HOME).
export type RepoState = 'repo' | 'inside' | 'none'
export function repoState(dir: string, root: string | null | undefined): RepoState {
  const d = dir.trim().replace(/\/+$/, '')
  const r = (root || '').trim().replace(/\/+$/, '')
  if (!r) return 'none'
  return r === d ? 'repo' : d.startsWith(`${r}/`) ? 'inside' : 'none'
}

// Valeur de `--repo` : le chemin seul si le dépôt est sur la machine où tourne
// herdr-projects, sinon `chemin@<id Herdr de la machine>`. Seul un projet de la
// machine locale peut viser une machine distante (les ids viennent de son
// `herdr machine list`) ; autre cas : null. Un chemin seul qui finit par
// « @nom » serait lu comme une machine par herdr-projects : refusé aussi.
export interface RepoMachine { local: boolean, profileId: string | null }
export function repoArgument(path: string, repo: RepoMachine, project: RepoMachine): string | null {
  const same = repo.local ? project.local : !project.local && repo.profileId === project.profileId
  if (same) return /@[A-Za-z0-9._-]+$/.test(path) ? null : path
  if (!project.local || repo.local || !repo.profileId || !/^[A-Za-z0-9._-]+$/.test(repo.profileId)) return null
  return `${path}@${repo.profileId}`
}

// Tâche en cours d'un workspace adopté : ajoutée à l'objectif, que le plugin
// écrit dans PROJECT.md (adopt-workspace n'a pas d'option dédiée). Sans
// objectif, la tâche seule en tient lieu.
export function goalWithTask(goal: string, task: string | undefined, lang: 'fr' | 'en' = 'en'): string {
  const t = (task || '').trim()
  if (!t) return goal
  if (!goal.trim()) return t
  const sep = /[.!?…]$/.test(goal) ? '' : '.'
  return `${goal}${sep} ${lang === 'fr' ? 'Tâche en cours' : 'Current task'}: ${t}`
}

export interface ProjectContext {
  pane?: string // identifiant local du pane (w1:p1)
  cwd?: string // dossier du pane
  session: string // session Herdr de la machine
  lang?: 'fr' | 'en'
}

// argv de la commande herdr-projects ; jamais de shell, chaque valeur est un argument.
export function projectCommandArgs(action: string, input: ProjectInput, ctx: ProjectContext): string[] {
  const session = ctx.session && ctx.session !== 'default' ? ['--session', ctx.session] : []
  // --goal seulement s'il y a quelque chose à écrire (défaut du plugin : vide).
  const goalArg = (g: string) => g ? ['--goal', g] : []
  if (action === 'adopt-workspace') {
    if (!ctx.pane || !ctx.cwd) throw new Error('pane et dossier nécessaires')
    return ['adopt-workspace', '--name', input.name!, '--pane', ctx.pane, '--workspace-cwd', ctx.cwd,
      ...goalArg(goalWithTask(input.goal || '', input.task, ctx.lang)), ...session]
  }
  if (action === 'new') return ['new', input.name!, ...goalArg(input.goal || ''), ...(input.repo ? ['--repo', input.repo] : [])]
  if (action === 'open') return ['open', input.slug!, ...session]
  if (action === 'doctor') return ['doctor', ...session]
  return [action, input.slug!]
}

// Conversation sans aucun message (agent tout juste lancé) : l'adopter n'apporte
// rien, mieux vaut un nouveau projet. Agent non lisible par wherdr : inconnu (null).
export function conversationEmpty(r: Pick<ChatResponse, 'available' | 'reason' | 'items'> | null | undefined): boolean | null {
  if (!r) return null
  if (!r.available) return r.reason === 'not_found' ? true : null
  return !(r.items || []).some(i => (i.role === 'user' || i.role === 'assistant') && i.text.trim())
}

// En-tête de « Check setup » : ce que wherdr utilise sur la machine, pour
// repérer un décalage avec le client Herdr (autre HOME, autre binaire).
export interface SetupLine { key: 'version' | 'binary' | 'home' | 'config', value: string, warn?: boolean }
export function setupHeader(o: { version: string | null, binary: string, home: string }): SetupLine[] {
  const home = o.home.replace(/\/+$/, '')
  const version = (o.version || '').replace(/^herdr-projects\s+/, '').trim()
  return [
    { key: 'version', value: version || '?', warn: !version },
    { key: 'binary', value: o.binary, warn: Boolean(home) && !o.binary.startsWith(`${home}/`) },
    { key: 'home', value: home || '?', warn: !home },
    { key: 'config', value: home ? `${home}/.config/herdr/config.toml` : '?' },
  ]
}

// Lignes de `doctor` : « [ok  ] … », « [warn] … », « [FAIL] … ».
export function doctorLevel(line: string): 'ok' | 'warn' | 'fail' | null {
  const m = /^\[(ok|warn|fail)\s*\]/i.exec(line.trim())
  return m ? m[1]!.toLowerCase() as 'ok' | 'warn' | 'fail' : null
}

// Dépôt proposé pour « New project » : la racine Git du dossier du space
// (`git rev-parse --show-toplevel`), sous le HOME de la machine. Jamais le HOME
// lui-même (un dépôt de dotfiles n'est pas le dépôt d'un projet) ; sinon rien.
export function proposedRepo(root: string | null | undefined, home: string): string {
  const r = (root || '').trim().replace(/\/+$/, '')
  const h = home.replace(/\/+$/, '')
  return r.startsWith('/') && h && r.startsWith(`${h}/`) ? r : ''
}

// `herdr-projects ticker status` : « ticker: running » ou « ticker: not running ».
export function tickerRunning(status: string | null | undefined): boolean {
  return /^ticker: running\b/m.test(status || '')
}

// Écriture refusée par un système de fichiers en lecture seule (EROFS), telle
// que herdr-projects la rapporte : « could not create <chemin>: Read-only file
// system (os error 30) ». Message clair à la place, ou null pour une autre erreur.
export function readOnlyMessage(error: string, o: { docker: boolean, lang?: 'fr' | 'en' }): string | null {
  if (!/read-only file system|os error 30\b|EROFS/i.test(error)) return null
  const path = /(\/[^:\n]*?):\s*Read-only file system/i.exec(error)?.[1] || ''
  const fr = o.lang === 'fr'
  if (o.docker) {
    return fr
      ? `wherdr tourne en Docker avec le HOME en lecture seule : herdr-projects ne peut pas écrire${path ? ` dans ${path}` : ''}. Montez son dossier de projets (~/.herdr-projects par défaut) en écriture dans docker-compose.yml (cf. README, « Herdr plugins »), puis relancez le conteneur.`
      : `wherdr runs in Docker with your home folder read-only: herdr-projects cannot write${path ? ` to ${path}` : ''}. Mount its projects folder (~/.herdr-projects by default) read-write in docker-compose.yml (see README, “Herdr plugins”), then restart the container.`
  }
  return fr
    ? `herdr-projects ne peut pas écrire${path ? ` dans ${path}` : ''} : système de fichiers en lecture seule.`
    : `herdr-projects cannot write${path ? ` to ${path}` : ''}: read-only file system.`
}
