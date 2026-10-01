// Panneau « Projet » du coordinateur herdr-projects : lecture de TASKS.md et
// des threads (`herdr-projects thread list --json`). Fonctions pures, testées
// dans tests/projectBoard.test.ts.
//
// TASKS.md (écrit par le coordinateur) : des listes `## Titre` libres, une
// tâche par ligne `- [ ] <titre> (<responsable>)`, le responsable étant `me`,
// `agent`, un nom, ou `agent → t-0031` (lu, jamais affiché). Seule décoration :
// les badges `[b:couleur(texte)]` et `[b:couleur(texte)](cible)` que le
// coordinateur place quand c'est utile (aucun badge automatique).

export type ListKind = 'test' | 'decide' | 'review' | 'blocked' | 'doing' | 'backlog' | 'done'

export interface ProjectTask {
  text: string
  done: boolean
  owner: string | null // tel qu'écrit : « me », « agent », « Alice »…
  thread: string | null // t-0031 (responsable « agent → t-0031 »)
  reason?: string // cause d'une tâche dans la liste Bloqué
  badges?: TaskBadge[] // badges `[b:couleur(texte)](cible)`, dans l'ordre
}
// Badge écrit par le coordinateur : couleur = nom de la palette, hex
// normalisé (#rrggbb) ou null (neutre). Le texte est brut (rendu échappé).
// Cible facultative : URL http(s) (`href`) ou ID de thread (`thread`) ; tout
// autre schéma est ignoré (badge non cliquable).
export interface TaskBadge { text: string, color: string | null, href?: string, thread?: string }
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
  ['review', /^(a relire|relire|relecture|to review|review|reviews|code review|pr|prs|pull requests?|a valider|to validate)$/],
  ['blocked', /^(bloque(?:e|es|s)?|blocked|on hold|en attente|waiting|stuck)$/],
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
// Ancienne syntaxe `[t-0140]` / `[t-0140, t-0141]` : retirée du texte, sans badge.
const REFS = /\s*\[\s*t-\d{4,}(?:\s*[,;\s]\s*t-\d{4,})*\s*\]/gi
// Badges : `[b:#fff(texte)]`, `[b:green(texte)]`, `[b:(texte)]`, suivis ou non
// de `(cible)`, où que ce soit dans la ligne. Le texte va jusqu'au premier « )] ».
export const BADGE_COLORS = ['red', 'orange', 'amber', 'green', 'teal', 'blue', 'violet', 'pink', 'gray'] as const
const BADGE = /\[b:\s*([#\w-]*)\s*\((.*?)\)\](?:\(\s*((?:[^\s()]|\([^\s()]*\))*)\s*\))?/gi
export function badgeColor(raw: string): string | null {
  const c = raw.trim().toLowerCase()
  if ((BADGE_COLORS as readonly string[]).includes(c)) return c
  if (c === 'grey') return 'gray'
  const h = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(c)
  if (!h) return null
  const x = h[1]!
  return '#' + (x.length === 3 ? [...x].map(d => d + d).join('') : x)
}
// Cible d'un badge : URL http(s) valide, ou ID de thread ; sinon rien.
export function badgeTarget(raw: string | undefined): { href: string } | { thread: string } | null {
  const v = (raw || '').trim()
  if (/^t-\d{4,}$/i.test(v)) return { thread: v.toLowerCase() }
  if (!/^https?:\/\//i.test(v)) return null
  try {
    const u = new URL(v)
    return u.protocol === 'https:' || u.protocol === 'http:' ? { href: u.href } : null
  } catch { return null }
}
export function takeBadges(input: string): { text: string, badges: TaskBadge[] } {
  const badges: TaskBadge[] = []
  const text = input.replace(BADGE, (all, color: string, label: string, target?: string) => {
    const t = label.replace(/\s+/g, ' ').trim()
    if (!t) return all
    badges.push({ text: t, color: badgeColor(color), ...(badgeTarget(target) || {}) })
    return ' '
  })
  return badges.length ? { text: text.replace(/\s{2,}/g, ' ').trim(), badges } : { text: input, badges }
}

export function parseTaskLine(line: string, kind: ListKind | null = null): ProjectTask | null {
  const m = TASK_LINE.exec(line.trim())
  if (!m) return null
  const free = takeBadges(m[2]!.trim())
  let text = free.text.replace(REFS, '').trim()
  let owner: string | null = null
  const o = OWNER.exec(text)
  // « [PR](https://…) » en fin de ligne : un lien Markdown, pas un responsable.
  if (o && o.index > 0 && !(text[o.index] === '(' && text[o.index - 1] === ']')) {
    owner = o[1]!.trim()
    text = text.slice(0, o.index).trim()
  }
  let reason: string | undefined
  if (kind === 'blocked') {
    const cause = /\s+—\s*(?:bloqu[eé]e? par|blocked by)\s*:\s*(.+)$/i.exec(text)
    if (cause?.[1]?.trim()) {
      reason = cause[1].trim()
      text = text.slice(0, cause.index).trim()
    }
  }
  if (!text) text = free.badges.map(b => b.text).join(' · ')
  if (!text) return null
  const ref = owner && THREAD_ID.exec(owner)
  return { text, done: m[1] === 'x' || m[1] === 'X', owner, thread: ref ? ref[0].toLowerCase() : null, ...(reason ? { reason } : {}), ...(free.badges.length ? { badges: free.badges } : {}) }
}

// Texte d'une tâche découpé pour l'affichage : les URL http(s) nues (ou entre
// <…>) et les liens Markdown [libellé](url) deviennent des liens texte
// simples ; le reste est du texte. Les autres schémas restent du texte.
export interface TextPart { text: string, href?: string }
const LINKISH = /\[([^\]]+)\]\((https?:\/\/[^\s()]+)\)|<?(https?:\/\/[^\s<>]+?)>?(?=[\s,;]|[.)!?]*(?:\s|$))/gi
export function textParts(input: string): TextPart[] {
  const parts: TextPart[] = []
  let at = 0
  const push = (text: string, href?: string) => {
    if (!text) return
    const last = parts[parts.length - 1]
    if (!href && last && !last.href) last.text += text
    else parts.push(href ? { text, href } : { text })
  }
  for (const m of input.matchAll(LINKISH)) {
    const raw = m[2] || m[3]!
    const t = badgeTarget(raw)
    push(input.slice(at, m.index))
    if (t && 'href' in t) push(m[1] || raw, t.href)
    else push(m[0])
    at = m.index! + m[0].length
  }
  push(input.slice(at))
  return parts
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
    const task = parseTaskLine(raw, cur.kind)
    if (task) cur.tasks.push(task)
  }
  return lists
}

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
    const at = sections.findIndex(s => s.kind !== 'test' && s.kind !== 'decide' && s.kind !== 'review' && s.kind !== 'blocked')
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

// Réglage « Masquer les listes vides » : une section sans tâche ni thread
// n'est pas affichée (En cours et Fait compris). La suggestion des listes
// absentes (missingLists) lit TASKS.md, pas cet affichage.
export function visibleSections(sections: BoardSection[], hideEmpty: boolean): BoardSection[] {
  return hideEmpty ? sections.filter(s => s.tasks.length > 0 || s.threads.length > 0) : sections
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

// « Lancer » est envoyé immédiatement ; « Préciser » prépare un brouillon.
export function launchMessage(task: string, lang: TestLang = 'fr'): string {
  return `${lang === 'en' ? '↳ Launch: ' : '↳ Lancer : '}${task.trim()}`
}

export function detailPrefix(task: string, lang: TestLang = 'fr'): string {
  return `${lang === 'en' ? '↳ Detail on ' : '↳ Précision sur '}${task.trim()} — `
}

export function reviewedMessage(task: string, lang: TestLang = 'fr'): string {
  return `${lang === 'en' ? '✓ Reviewed: ' : '✓ Relu : '}${task.trim()}`
}

export function reviewCommentPrefix(task: string, lang: TestLang = 'fr'): string {
  return `${lang === 'en' ? '↳ Feedback on ' : '↳ Retour sur '}${task.trim()}${lang === 'en' ? ': ' : ' : '}`
}

export function unblockMessage(task: string, lang: TestLang = 'fr'): string {
  return `${lang === 'en' ? '↳ Unblock: ' : '↳ Débloquer : '}${task.trim()}`
}

// ---------------------------------------------------------------- aide (Réglages › Plugins)
// Listes recommandées de TASKS.md, dans l'ordre du modèle. herdr-projects
// n'impose que des listes `##` ; « À tester » et « À décider » sont une
// convention de wherdr, lue par le panneau Projet.
const TEMPLATE_LISTS: { kind: ListKind, fr: string, en: string }[] = [
  { kind: 'test', fr: 'À tester', en: 'To test' },
  { kind: 'decide', fr: 'À décider', en: 'To decide' },
  { kind: 'review', fr: 'À relire', en: 'To review' },
  { kind: 'blocked', fr: 'Bloqué', en: 'Blocked' },
  { kind: 'doing', fr: 'En cours', en: 'In progress' },
  { kind: 'backlog', fr: 'Backlog', en: 'Backlog' },
]

export function listTitle(kind: ListKind, lang: TestLang = 'fr'): string {
  if (kind === 'done') return lang === 'en' ? 'Done' : 'Fait'
  const l = TEMPLATE_LISTS.find(x => x.kind === kind)!
  return lang === 'en' ? l.en : l.fr
}

export function tasksTemplate(lang: TestLang = 'fr'): string {
  const ex = lang === 'en'
    ? { test: '- [ ] Check the new settings page (me)', decide: '- [ ] Keep the old layout? (me)', review: '- [ ] Offline banner [b:blue(PR #12)](https://github.com/owner/repo/pull/12) (me)', blocked: '- [ ] Publish the guide — blocked by: review (agent)', doing: '- [ ] Fix the offline banner [b:gray(t-0001)](t-0001) (agent → t-0001)', backlog: '- [ ] Dark mode for charts (agent)' }
    : { test: '- [ ] Vérifier la nouvelle page Réglages (me)', decide: '- [ ] Garder l’ancienne disposition ? (me)', review: '- [ ] Bandeau hors ligne [b:blue(PR #12)](https://github.com/owner/repo/pull/12) (me)', blocked: '- [ ] Publier le guide — bloqué par : relecture (agent)', doing: '- [ ] Corriger le bandeau hors ligne [b:gray(t-0001)](t-0001) (agent → t-0001)', backlog: '- [ ] Mode sombre des graphiques (agent)' }
  const blocks = TEMPLATE_LISTS.map(l => `## ${lang === 'en' ? l.en : l.fr}\n\n${ex[l.kind as keyof typeof ex]}`)
  return `# Tasks\n\n${blocks.join('\n\n')}\n`
}

// Listes de la convention wherdr absentes de TASKS.md (suggestion du panneau).
export function missingLists(lists: Pick<ProjectList, 'kind'>[]): ListKind[] {
  return (['test', 'decide'] as ListKind[]).filter(k => !lists.some(l => l.kind === k))
}

// Texte à coller au coordinateur : ce que signifient les messages du panneau.
export function coordinatorRules(lang: TestLang = 'fr'): string {
  const en = lang === 'en'
  const m = (prefix: (task: string, lang: TestLang) => string) => `${prefix('…', lang)}…`
  const lines = en
    ? [
        'wherdr Project panel: TASKS.md conventions and messages.',
        'Lists: "## To test" (what I must check after a deploy), "## To decide" (questions for me), "## To review" (pull requests for me to review), "## Blocked" (waiting for something external), "## In progress" (threads), "## Backlog". One task per line: "- [ ] title (owner)", owner = me, agent or "agent → t-0140" (not shown); blocked tasks may add "— blocked by: reason" before the owner.',
        'Badges (the only decoration wherdr shows): "[b:color(text)]", or "[b:color(text)](target)" for a clickable badge. Color: red, orange, amber, green, teal, blue, violet, pink, gray, #hex, or nothing (neutral). Target: an https:// link (opens a new tab) or a thread ID like t-0140 (opens its tab). Short text (24 characters max). E.g. "- [ ] Stop button [b:red(bug)] [b:gray(t-0140)](t-0140) [b:blue(PR #12)](https://github.com/owner/repo/pull/12) (me)".',
        'Use badges on your own whenever they help me (status, owner, thread, PR, device, priority…), and follow the badge preferences I give you. Stay sparse: two or three badges per line at most. A bare URL in a task shows as a plain link.',
        `"${testedMessage('…', lang)}" → remove the line from To test.`,
        `"${m(problemPrefix)}" → treat it as a bug: fix it (new thread).`,
        `"${m(questionPrefix)}" → answer: explain what to test and how.`,
        `"${m(decisionPrefix)}" → apply the decision and remove the line from To decide.`,
        `"${reviewedMessage('…', lang)}" → remove the line from To review.`,
        `"${reviewCommentPrefix('…', lang)}…" → take the review feedback into account (on the PR or in a thread).`,
        `"${unblockMessage('…', lang)}" → restart the task or ask what is missing. Move a task to Blocked when it waits for something external.`,
        `"${launchMessage('…', lang)}" → launch a thread for this Backlog task.`,
        `"${m(detailPrefix)}" → add the detail to the task.`,
        'After each deploy, add to To test what I must check. Put in To review each pull request I must review, with its link (link badge).',
        'The ## lists in TASKS.md are the active lists: I ask you when one must be added or removed.',
      ]
    : [
        'Panneau Projet de wherdr : conventions de TASKS.md et messages.',
        'Listes : « ## À tester » (ce que je dois vérifier après un déploiement), « ## À décider » (questions pour moi), « ## À relire » (PR que je dois relire), « ## Bloqué » (attente extérieure), « ## En cours » (threads), « ## Backlog ». Une tâche par ligne : « - [ ] titre (responsable) », responsable = me, agent ou « agent → t-0140 » (non affiché) ; une tâche bloquée peut ajouter « — bloqué par : raison » avant le responsable.',
        'Badges (seule décoration affichée par wherdr) : « [b:couleur(texte)] », ou « [b:couleur(texte)](cible) » pour un badge cliquable. Couleur : red, orange, amber, green, teal, blue, violet, pink, gray, #hex, ou rien (neutre). Cible : un lien https:// (nouvel onglet) ou un ID de thread comme t-0140 (ouvre son onglet). Texte court (24 caractères au plus). Ex. « - [ ] Bouton Stop [b:red(bug)] [b:gray(t-0140)](t-0140) [b:blue(PR #12)](https://github.com/owner/repo/pull/12) (me) ».',
        'Utilise les badges de toi-même quand ils me sont utiles (statut, responsable, thread, PR, appareil, priorité…), et suis les préférences de badges que je te donne. Reste sobre : deux ou trois badges par ligne au plus. Une URL brute dans une tâche s’affiche en lien simple.',
        `« ${testedMessage('…', lang)} » → retirer la ligne d’À tester.`,
        `« ${m(problemPrefix)} » → c’est un bug : le corriger (nouveau thread).`,
        `« ${m(questionPrefix)} » → répondre : expliquer quoi tester et comment.`,
        `« ${m(decisionPrefix)} » → appliquer la décision et retirer la ligne d’À décider.`,
        `« ${reviewedMessage('…', lang)} » → retirer la ligne d’À relire.`,
        `« ${reviewCommentPrefix('…', lang)}… » → prendre en compte ce retour de relecture (sur la PR ou dans un thread).`,
        `« ${unblockMessage('…', lang)} » → relancer la tâche ou demander ce qui manque. Déplacer une tâche en Bloqué quand elle attend quelque chose d’extérieur.`,
        `« ${launchMessage('…', lang)} » → lancer un thread pour cette tâche du Backlog.`,
        `« ${m(detailPrefix)} » → compléter la tâche avec cette précision.`,
        'Après chaque déploiement, ajouter à À tester ce que je dois vérifier. Mettre dans À relire chaque PR que je dois relire, avec son lien (badge-lien).',
        'Les listes ## de TASKS.md sont les listes actives : je te demande d’en ajouter ou d’en retirer une.',
      ]
  return `${lines.join('\n')}\n`
}
