// herdr-projects actions run from wherdr on the command line: expected
// inputs and argv (pure functions, tested in tests/projectsActions.test.ts).
// Options checked against herdr-projects 0.2.30 (`<command> --help`):
//  - adopt-workspace --name --pane --workspace-cwd --goal --session (no option
//    for the current task: it joins the goal);
//  - new <name> --goal --repo <PATH[@MACHINE]> (MACHINE: id or label of a
//    machine from `herdr machine list`, letters, digits, "- _ ." only);
//  - open / pause / resume <slug>, doctor --session.
import type { ChatResponse } from './types'

export const PROJECT_INPUTS: Record<string, string[]> = {
  new: ['name'], 'adopt-workspace': ['name'], open: ['slug'], pause: ['slug'], resume: ['slug'],
}
// Optional inputs, on top of the fields above. The goal is optional too:
// herdr-projects does not require it and an ongoing project has no fixed course.
// `machine`: wherdr key of the repository's machine (missing = the project's).
export const PROJECT_OPTIONAL: Record<string, string[]> = { new: ['goal', 'repo', 'machine'], 'adopt-workspace': ['goal', 'task'] }
// Fields to fill in: name (or slug).
export const PROJECT_REQUIRED: Record<string, string[]> = {
  new: ['name'], 'adopt-workspace': ['name'], open: ['slug'], pause: ['slug'], resume: ['slug'],
}
export const INPUT_MAX: Record<string, number> = { name: 120, slug: 120, goal: 400, task: 400, repo: 1024, machine: 64 }

export type ProjectInput = Partial<Record<'name' | 'goal' | 'task' | 'slug' | 'repo' | 'machine', string>>

// Cleaned input, or null if a field is missing or too long.
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
    // Name or slug passed as an argument: "-…" would be read as an option.
    if ((key === 'name' || key === 'slug') && s.startsWith('-')) return null
    if (s) out[key as keyof ProjectInput] = s
  }
  // The server applies the same name rule as the form.
  if (out.name && !projectNameOk(out.name)) return null
  return (PROJECT_REQUIRED[action] || []).every(k => out[k as keyof ProjectInput]) ? out : null
}

// Project name accepted by herdr-projects (`slug_from_name`): no "/",
// "\" or "..", and at least one ASCII letter or digit for the slug.
// "~" (label of a space opened in HOME) or a path are not valid names.
export function projectNameOk(name: string | null | undefined): boolean {
  const s = (name || '').trim()
  return Boolean(s) && !/[/\\]|\.\./.test(s) && /[a-z0-9]/i.test(s)
}

// Suggested name: "New project" takes the folder name of the chosen repository (nothing
// without a repository); adoption, the space label. Never a rejected name.
export function suggestedProjectName(action: string, o: { repo?: string | null, space?: string | null }): string {
  const name = action === 'new'
    ? (o.repo || '').replace(/\/+$/, '').split('/').pop() || ''
    : (o.space || '').trim()
  return projectNameOk(name) ? name : ''
}

// State of the folder chosen as repository, according to /api/gitroot (suggested Git
// root, or null): the repository itself, a subfolder of the `root` repository, or
// nothing usable (outside a repository, or HOME).
export type RepoState = 'repo' | 'inside' | 'none'
export function repoState(dir: string, root: string | null | undefined): RepoState {
  const d = dir.trim().replace(/\/+$/, '')
  const r = (root || '').trim().replace(/\/+$/, '')
  if (!r) return 'none'
  return r === d ? 'repo' : d.startsWith(`${r}/`) ? 'inside' : 'none'
}

// `--repo` value: the path alone if the repository is on the machine running
// herdr-projects, otherwise `path@<Herdr id of the machine>`. Only a project on the
// local machine can target a remote machine (the ids come from its
// `herdr machine list`); other cases: null. A bare path ending with
// "@name" would be read as a machine by herdr-projects: rejected too.
export interface RepoMachine { local: boolean, profileId: string | null }
export function repoArgument(path: string, repo: RepoMachine, project: RepoMachine): string | null {
  const same = repo.local ? project.local : !project.local && repo.profileId === project.profileId
  if (same) return /@[A-Za-z0-9._-]+$/.test(path) ? null : path
  if (!project.local || repo.local || !repo.profileId || !/^[A-Za-z0-9._-]+$/.test(repo.profileId)) return null
  return `${path}@${repo.profileId}`
}

// Current task of an adopted workspace: appended to the goal, which the plugin
// writes into PROJECT.md (adopt-workspace has no dedicated option). Without
// a goal, the task alone stands in for it.
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

// argv of the herdr-projects command; never a shell, each value is one argument.
export function projectCommandArgs(action: string, input: ProjectInput, ctx: ProjectContext): string[] {
  const session = ctx.session && ctx.session !== 'default' ? ['--session', ctx.session] : []
  // --goal only if there is something to write (plugin default: empty).
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

// Conversation without any message (agent just launched): adopting it brings
// nothing, a new project is better. Agent not readable by wherdr: unknown (null).
export function conversationEmpty(r: Pick<ChatResponse, 'available' | 'reason' | 'items'> | null | undefined): boolean | null {
  if (!r) return null
  if (!r.available) return r.reason === 'not_found' ? true : null
  return !(r.items || []).some(i => (i.role === 'user' || i.role === 'assistant') && i.text.trim())
}

// "Check setup" header: what wherdr uses on the machine, to
// spot a mismatch with the Herdr client (other HOME, other binary).
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

// `doctor` lines: "[ok  ] …", "[warn] …", "[FAIL] …".
export function doctorLevel(line: string): 'ok' | 'warn' | 'fail' | null {
  const m = /^\[(ok|warn|fail)\s*\]/i.exec(line.trim())
  return m ? m[1]!.toLowerCase() as 'ok' | 'warn' | 'fail' : null
}

// Repository suggested for "New project": the Git root of the space's folder
// (`git rev-parse --show-toplevel`), under the machine's HOME. Never HOME
// itself (a dotfiles repository is not a project's repository); otherwise nothing.
export function proposedRepo(root: string | null | undefined, home: string): string {
  const r = (root || '').trim().replace(/\/+$/, '')
  const h = home.replace(/\/+$/, '')
  return r.startsWith('/') && h && r.startsWith(`${h}/`) ? r : ''
}

// `herdr-projects ticker status`: "ticker: running" or "ticker: not running".
export function tickerRunning(status: string | null | undefined): boolean {
  return /^ticker: running\b/m.test(status || '')
}

// Write refused by a read-only file system (EROFS), as
// herdr-projects reports it: "could not create <path>: Read-only file
// system (os error 30)". A clear message instead, or null for another error.
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
