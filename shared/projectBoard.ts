// Panneau « Projet » du coordinateur herdr-projects : lecture de TASKS.md et
// des threads (`herdr-projects thread list --json`). Fonctions pures, testées
// dans tests/projectBoard.test.ts.
//
// TASKS.md (écrit par le coordinateur) : des listes `## Titre` libres, une
// tâche par ligne `- [ ] <titre> (<responsable>)`, le responsable étant `me`,
// `agent`, un nom, ou `agent → t-0031`.

export type ListKind = 'test' | 'decide' | 'doing' | 'backlog' | 'done'

export interface ProjectTask {
  text: string
  done: boolean
  owner: string | null // tel qu'écrit : « me », « agent », « Alice »…
  thread: string | null // t-0031 (responsable « agent → t-0031 »)
}
export interface ProjectList { title: string, kind: ListKind | null, tasks: ProjectTask[] }

export interface ProjectThread {
  id: string // t-0034
  title: string
  group: string // libellé de herdr-projects (« Ready for review »)
  token: string // ready-for-review, working, waiting-on-you, landing, idle, resolved
  rank: number // 1 (Waiting on you) … 6 (Resolved)
  resolved: boolean
  updated: string // ISO
  created: string
  agentName: string | null // nom du pane (hp-<slug>-t-NNNN)
  machine: string // nom de la machine chez herdr-projects (vide : la sienne)
  activity: string
  percent: number | null
  pr: string
  report: boolean
}

export interface ProjectBoard {
  slug: string
  lists: ProjectList[]
  open: ProjectThread[]
  resolved: ProjectThread[]
  version: string
  // TASKS.md absent, ou threads illisibles : le panneau le dit sans casser.
  tasksMissing?: boolean
  threadsError?: string
}

// ---------------------------------------------------------------- TASKS.md
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

const KINDS: [ListKind, RegExp][] = [
  ['test', /^(a tester|to test|testing|to verify|a verifier|test)$/],
  ['decide', /^(a decider|to decide|decisions?|decide|questions?)$/],
  ['doing', /^(en cours|in progress|doing|ongoing|wip|active)$/],
  ['backlog', /^(backlog|a faire|todo|to do|next|later|plus tard|idees|ideas)$/],
  ['done', /^(fait|faits|done|termine|terminees?|finished|completed?)$/],
]
export function listKind(title: string): ListKind | null {
  const f = fold(title)
  return KINDS.find(([, re]) => re.test(f))?.[0] ?? null
}

const THREAD_ID = /\bt-\d{4,}\b/i
const TASK_LINE = /^[-*+]\s+(?:\[([ xX])\](?:\s+|$))?(.*)$/
// Responsable : dernière parenthèse de la ligne, courte, sans parenthèse imbriquée.
const OWNER = /\s*\(([^()]{1,48})\)\s*$/

export function parseTaskLine(line: string): ProjectTask | null {
  const m = TASK_LINE.exec(line.trim())
  if (!m) return null
  let text = m[2]!.trim()
  let owner: string | null = null
  const o = OWNER.exec(text)
  if (o && o.index > 0) {
    owner = o[1]!.trim()
    text = text.slice(0, o.index).trim()
  }
  if (!text) return null
  const ref = owner && THREAD_ID.exec(owner)
  return { text, done: m[1] === 'x' || m[1] === 'X', owner, thread: ref ? ref[0].toLowerCase() : null }
}

// Toutes les listes `##`, dans l'ordre du fichier (vides comprises). Les lignes
// hors d'une liste, les sous-titres plus profonds et les lignes indentées
// (détails d'une tâche) sont ignorés.
export function parseTasks(md: string): ProjectList[] {
  const lists: ProjectList[] = []
  let cur: ProjectList | null = null
  let fence = false
  for (const raw of String(md || '').replace(/\r\n?/g, '\n').split('\n')) {
    if (/^\s*(```|~~~)/.test(raw)) { fence = !fence; continue }
    if (fence) continue
    const h = /^##\s+(.+?)\s*#*\s*$/.exec(raw)
    if (h) {
      cur = { title: h[1]!, kind: listKind(h[1]!), tasks: [] }
      lists.push(cur)
      continue
    }
    if (/^#\s/.test(raw)) { cur = null; continue }
    if (!cur || /^\s/.test(raw)) continue
    const task = parseTaskLine(raw)
    if (task) cur.tasks.push(task)
  }
  return lists
}

// Responsable humain (« me », « moi », « user ») : c'est à l'utilisateur.
export const ownerIsMe = (owner: string | null) => Boolean(owner && /^(me|moi|user|utilisateur|you|toi)$/i.test(owner.trim()))

// ---------------------------------------------------------------- threads
type Raw = Record<string, unknown>
const str = (v: unknown) => (typeof v === 'string' ? v : '')

export function normalizeThreads(raw: unknown): ProjectThread[] {
  if (!Array.isArray(raw)) return []
  const out: ProjectThread[] = []
  for (const r of raw as Raw[]) {
    if (!r || typeof r !== 'object') continue
    const id = str(r.id)
    if (!/^t-\d{4,}$/.test(id)) continue
    const token = str(r.group_token) || (str(r.status) === 'resolved' ? 'resolved' : '')
    const resolved = str(r.status) === 'resolved' || token === 'resolved'
    const rank = typeof r.rank === 'number' && Number.isFinite(r.rank) ? r.rank : resolved ? 6 : 5
    out.push({
      id,
      title: str(r.title).trim() || id,
      group: str(r.group) || (resolved ? 'Resolved' : ''),
      token,
      rank,
      resolved,
      updated: str(r.updated),
      created: str(r.created),
      agentName: str(r.agent_name) || null,
      machine: str(r.machine),
      activity: str(r.activity).trim(),
      percent: typeof r.percent === 'number' && Number.isFinite(r.percent) ? Math.max(0, Math.min(100, Math.round(r.percent))) : null,
      pr: /^https:\/\//.test(str(r.pr)) ? str(r.pr) : '',
      report: typeof r.report === 'string' && r.report.length > 0,
    })
  }
  return out
}

const num = (id: string) => Number(id.slice(2)) || 0
const time = (iso: string) => {
  const t = Date.parse(iso)
  return Number.isFinite(t) ? t : 0
}

// Threads ouverts : ce qui t'attend d'abord (rang de herdr-projects), puis les
// plus récents. Threads faits : le dernier mis à jour (clôture) en premier.
export function sortOpen(list: ProjectThread[]): ProjectThread[] {
  return [...list].sort((a, b) => a.rank - b.rank || num(b.id) - num(a.id))
}
export function sortResolved(list: ProjectThread[]): ProjectThread[] {
  return [...list].sort((a, b) => time(b.updated) - time(a.updated) || num(b.id) - num(a.id))
}
export function splitThreads(list: ProjectThread[]): { open: ProjectThread[], resolved: ProjectThread[] } {
  return {
    open: sortOpen(list.filter(t => !t.resolved)),
    resolved: sortResolved(list.filter(t => t.resolved)),
  }
}

// ---------------------------------------------------------------- sections
export interface BoardSection {
  key: string
  title: string // titre de la liste, ou libellé par défaut (null : à traduire côté app)
  kind: ListKind | null
  tasks: ProjectTask[]
  threads: ProjectThread[] // ouverts (En cours) ou faits (Fait)
}

// Sections affichées : les listes de TASKS.md dans leur ordre ; « En cours »
// reçoit les threads ouverts (une tâche qui renvoie à un thread ouvert est
// montrée par le thread, en direct) ; « Fait » reçoit les threads clôturés.
// Une section manquante est ajoutée : En cours avant la première liste qui
// n'est ni « à tester » ni « à décider », Fait à la fin.
export function boardSections(board: Pick<ProjectBoard, 'lists' | 'open' | 'resolved'>, labels: { doing: string, done: string }): BoardSection[] {
  const openIds = new Set(board.open.map(t => t.id))
  const sections: BoardSection[] = board.lists.map((l, i) => ({
    key: `l${i}`,
    title: l.title,
    kind: l.kind,
    tasks: l.kind === 'doing' ? l.tasks.filter(t => !(t.thread && openIds.has(t.thread))) : l.tasks,
    threads: [],
  }))
  let doing = sections.find(s => s.kind === 'doing')
  if (!doing && board.open.length) {
    doing = { key: 'doing', title: labels.doing, kind: 'doing', tasks: [], threads: [] }
    const at = sections.findIndex(s => s.kind !== 'test' && s.kind !== 'decide')
    sections.splice(at < 0 ? sections.length : at, 0, doing)
  }
  if (doing) doing.threads = board.open
  let done = sections.find(s => s.kind === 'done')
  if (!done) {
    done = { key: 'done', title: labels.done, kind: 'done', tasks: [], threads: [] }
    sections.push(done)
  } else {
    // La liste « Fait » va en dernier, avec les threads clôturés.
    sections.splice(sections.indexOf(done), 1)
    sections.push(done)
  }
  done.threads = board.resolved
  return sections
}


// ---------------------------------------------------------------- retours du panneau Projet
// Confirmer envoie un message ; les autres actions préparent le début du message.
export type TestLang = 'fr' | 'en'

export function testedMessage(task: string, lang: TestLang = 'fr'): string {
  return `${lang === 'en' ? '✓ Tested: ' : '✓ Testé : '}${task.trim()}`
}

export function problemPrefix(task: string, lang: TestLang = 'fr'): string {
  return `${lang === 'en' ? '✗ Problem: ' : '✗ Problème : '}${task.trim()} — `
}

export function questionPrefix(task: string, lang: TestLang = 'fr'): string {
  return `${lang === 'en' ? '? Question: ' : '? Question : '}${task.trim()} — `
}

export function decisionPrefix(task: string, lang: TestLang = 'fr'): string {
  return `${lang === 'en' ? '↳ Decision: ' : '↳ Décision : '}${task.trim()} — `
}

// Champ de saisie après une action du panneau : le brouillon déjà tapé
// est gardé, le début du message vient à la suite sur une nouvelle ligne
// (curseur à la fin). Déjà présent en fin de brouillon (double toucher) : rien
// ne change.
export function prefillDraft(draft: string, prefix: string): string {
  const kept = draft.replace(/\s+$/, '')
  if (!kept) return prefix
  if (kept.endsWith(prefix.trimEnd())) return `${kept} `
  return `${kept}\n${prefix}`
}
