// Actions de herdr-projects lancées depuis wherdr en ligne de commande : saisies
// attendues et argv (fonctions pures, testées dans tests/projectsActions.test.ts).
// Options vérifiées sur herdr-projects 0.2.30 (`<commande> --help`) :
//  - adopt-workspace --name --pane --workspace-cwd --goal --session (pas d'option
//    pour la tâche en cours : elle rejoint l'objectif) ;
//  - new <nom> --goal --repo <PATH[@MACHINE]> ;
//  - open / pause / resume <slug>, doctor --session.
import type { ChatResponse } from './types'

export const PROJECT_INPUTS: Record<string, string[]> = {
  new: ['name', 'goal'], 'adopt-workspace': ['name', 'goal'], open: ['slug'], pause: ['slug'], resume: ['slug'],
}
// Saisies facultatives, en plus des champs ci-dessus.
export const PROJECT_OPTIONAL: Record<string, string[]> = { new: ['repo'], 'adopt-workspace': ['task'] }
// Champs à remplir : nom (ou slug) et objectif.
export const PROJECT_REQUIRED: Record<string, string[]> = {
  new: ['name', 'goal'], 'adopt-workspace': ['name', 'goal'], open: ['slug'], pause: ['slug'], resume: ['slug'],
}
export const INPUT_MAX: Record<string, number> = { name: 120, slug: 120, goal: 400, task: 400, repo: 1024 }

export type ProjectInput = Partial<Record<'name' | 'goal' | 'task' | 'slug' | 'repo', string>>

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
    if (s) out[key as keyof ProjectInput] = s
  }
  return (PROJECT_REQUIRED[action] || []).every(k => out[k as keyof ProjectInput]) ? out : null
}

// Tâche en cours d'un workspace adopté : ajoutée à l'objectif, que le plugin
// écrit dans PROJECT.md (adopt-workspace n'a pas d'option dédiée).
export function goalWithTask(goal: string, task: string | undefined, lang: 'fr' | 'en' = 'en'): string {
  const t = (task || '').trim()
  if (!t) return goal
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
  if (action === 'adopt-workspace') {
    if (!ctx.pane || !ctx.cwd) throw new Error('pane et dossier nécessaires')
    return ['adopt-workspace', '--name', input.name!, '--pane', ctx.pane, '--workspace-cwd', ctx.cwd,
      '--goal', goalWithTask(input.goal || '', input.task, ctx.lang), ...session]
  }
  if (action === 'new') return ['new', input.name!, '--goal', input.goal || '', ...(input.repo ? ['--repo', input.repo] : [])]
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
