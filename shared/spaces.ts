// Liste par état, une ligne par space Herdr (workspace) : un space d'un seul
// onglet et d'un seul pane reste la carte de son agent ; sinon une carte de
// space, rangée d'après son pane le plus urgent. Onglet mémorisé par space,
// taille du miroir d'un terminal, touches envoyées à un miroir. Pur (testé).
import type { HerdrState, Pane, Workspace } from './types'
import { type TabEntry, tabEntry, workspaceTree } from './workspaces'

type State = Pick<HerdrState, 'workspaces' | 'panes'> & Partial<Pick<HerdrState, 'tabs'>>

// Urgence d'un pane (plus petit = plus urgent) : à toi de jouer, au travail,
// fini non lu, prêt, inconnu ; un terminal sans agent passe après.
const RANK: Record<string, number> = { blocked: 0, working: 1, done: 2, idle: 3, unknown: 4 }
export const urgency = (p: Pick<Pane, 'agent' | 'status'>) => (p.agent ? RANK[p.status || 'unknown'] ?? 4 : 9)

// Pane qui représente le space : le plus urgent, le premier dans l'ordre de
// lecture à égalité (onglets dans l'ordre, puis panes de chaque onglet).
export function leadPane<P extends Pick<Pane, 'agent' | 'status'>>(panes: P[]): P | null {
  let best: P | null = null
  for (const p of panes) if (!best || urgency(p) < urgency(best)) best = p
  return best
}

export interface PaneRow { kind: 'pane', key: string, pane: Pane, lead: Pane }
export interface SpaceRow {
  kind: 'space'
  key: string
  workspace: Workspace
  tabs: TabEntry[]
  panes: Pane[]
  lead: Pane
  // Onglet du pane représentatif (sa mini-carte).
  leadTab: TabEntry
  sum: { blocked: number, working: number, done: number, agents: number }
}
export type Row = PaneRow | SpaceRow

// Une ligne par space ouvert (`machine` : seulement celle-ci, '' = locale).
export function spaceRows(s: State, machine?: string): Row[] {
  return workspaceTree(s, machine).map((w) => {
    const tabs = w.tabs.filter(e => e.panes.length)
    const panes = tabs.flatMap(e => e.panes)
    const lead = leadPane(panes)!
    if (tabs.length === 1 && panes.length === 1) return { kind: 'pane', key: lead.id, pane: lead, lead }
    const n = (st: string) => panes.filter(p => p.agent && p.status === st).length
    return {
      kind: 'space',
      key: w.workspace.id,
      workspace: w.workspace,
      tabs,
      panes,
      lead,
      leadTab: tabs.find(e => e.panes.includes(lead))!,
      sum: { blocked: n('blocked'), working: n('working'), done: n('done'), agents: panes.filter(p => p.agent).length },
    }
  })
}

// Groupe de la liste : celui de son pane représentatif. Un space de shell
// (aucun agent) est rangé comme un space au repos, dans Prêts, comme dans la
// première liste de Herdr.
export type RowGroup = 'blocked' | 'working' | 'ready'
export const isShellRow = (r: Row) => !r.lead.agent
export function rowGroup(r: Row): RowGroup {
  const p = r.lead
  if (p.agent && p.status === 'blocked') return 'blocked'
  if (p.agent && p.status === 'working') return 'working'
  return 'ready'
}

// ------------------------------------------------------------ terminal racine
// herdr-projects ouvre un workspace « racine » sur le checkout principal d'un
// dépôt, qui porte dans Herdr le groupe des worktrees de ses threads. Dans la
// liste, ce n'est pas une carte : un petit en-tête « Dépôt <nom> · N worktrees »
// au-dessus des threads du projet. Un space de shell est la racine d'un dépôt
// si d'autres spaces de la même machine en sont des worktrees : même dépôt
// d'après Herdr (`repo`), sinon (Herdr sans ces champs) même nom de dossier
// que les worktrees de herdr-projects (~/.herdr/worktrees/<dépôt>/…). Le
// compteur ne voit que les worktrees ouverts dans Herdr sur cette machine.
export interface RepoRoot {
  row: Row
  name: string
  // Workspaces ouverts sur un worktree de ce dépôt.
  worktrees: string[]
}
const WT_DIR = /\/\.herdr\/worktrees\/([^/]+)\/[^/]+/
const cwdOf = (c: string | null | undefined) => (c || '').replace(/\\/g, '/').replace(/\/+$/, '')

export function repoRoots(s: Pick<HerdrState, 'workspaces' | 'panes'>, rows: Row[]): RepoRoot[] {
  const wsOf = new Map(s.workspaces.map(w => [w.id, w]))
  const panesOf = (ws: string) => s.panes.filter(p => p.workspace === ws)
  // Worktrees : repo (s'il est connu) et nom du dépôt.
  const trees = s.workspaces.flatMap((w) => {
    const dir = panesOf(w.id).map(p => WT_DIR.exec(cwdOf(p.cwd))?.[1]).find(Boolean)
    if (!w.worktree && !dir) return []
    return [{ id: w.id, machine: w.machine || '', repo: w.repo, name: w.repoName || dir || '' }]
  })
  const best = new Map<string, { number: number, root: RepoRoot }>()
  for (const row of rows) {
    if (!isShellRow(row)) continue
    const ws = wsOf.get(row.lead.workspace)
    if (!ws || ws.worktree || WT_DIR.test(cwdOf(row.lead.cwd))) continue
    const machine = ws.machine || ''
    const name = ws.repoName || cwdOf(row.lead.cwd).split('/').pop() || ''
    const mine = trees.filter(t => t.machine === machine && t.id !== ws.id
      && (ws.repo && t.repo ? t.repo === ws.repo : !ws.repo && Boolean(name) && t.name === name))
    if (!mine.length) continue
    // Un seul en-tête par dépôt : herdr-projects ouvre parfois plusieurs
    // shells à la racine (Herdr ne donne pas toujours leur dépôt, d'où la
    // clé par worktrees couverts) ; garde le plus ancien (numéro Herdr le plus
    // bas), les autres restent des terminaux ordinaires dans la liste.
    const key = `${machine}\0${mine.map(t => t.id).sort().join(' ')}`
    const kept = best.get(key)
    if (!kept || ws.number < kept.number) best.set(key, { number: ws.number, root: { row, name, worktrees: mine.map(t => t.id) } })
  }
  return [...best.values()].map(b => b.root)
}

// Racines rattachées à un projet : celles dont un worktree porte un de ses panes.
export function projectRoots(roots: RepoRoot[], panes: Pick<Pane, 'workspace'>[]): RepoRoot[] {
  return roots.filter(r => panes.some(p => r.worktrees.includes(p.workspace)))
}

// Le groupe Prêts peut être scindé en listes de dépôt indépendantes. L'ordre
// Herdr est conservé dans chaque liste ; un space est non lu si un pane a fini.
export function readyLists(rows: Row[], automatic: boolean): Row[][] {
  if (!automatic) return [rows]
  const unread = rows.filter(r => (r.kind === 'space' ? r.panes : [r.pane]).some(p => p.agent && p.status === 'done'))
  const read = rows.filter(r => !unread.includes(r))
  return [unread, read].filter(list => list.length)
}

// ------------------------------------------------------------ onglet mémorisé
// Dernier onglet ouvert de chaque space (workspace -> onglet).
export type TabMemory = Record<string, string>

// Onglet à ouvrir pour un space : le dernier ouvert s'il existe encore, sinon
// celui du pane le plus urgent, sinon le premier.
export function spaceTab(tabs: Pick<TabEntry, 'tab' | 'panes'>[], memory: TabMemory, workspace: string): string | null {
  const live = tabs.filter(e => e.panes.length)
  const kept = memory[workspace]
  if (kept && live.some(e => e.tab.id === kept)) return kept
  const lead = leadPane(live.flatMap(e => e.panes))
  return (lead && live.find(e => e.panes.includes(lead))?.tab.id) || live[0]?.tab.id || null
}

// ------------------------------------------------------------ après une fermeture
// Comme Herdr : fermer un onglet montre son voisin (le précédent, le suivant
// s'il était le premier) ; fermer un pane laisse dans son onglet s'il en
// reste ; la liste seulement quand le space n'a plus rien. Décidé avant
// l'appel, d'après l'état connu : pas de rebond vers la liste ni d'onglet
// fantôme en attendant l'état suivant de Herdr.
export type Closing = { tab: string } | { pane: string } | { workspace: string }
// Vue ouverte : un onglet (plan, côte à côte) ou un pane.
export type Viewed = { tab: string } | { pane: string }
// Où aller : un onglet, un pane (onglet d'un seul pane), la liste ; null = rester.
export type Landing = { tab: string } | { pane: string } | 'home' | null

// Onglets vivants (avec des panes) d'un space, dans l'ordre de Herdr.
function liveTabs(s: State, workspace: string): TabEntry[] {
  const ws = s.workspaces.find(w => w.id === workspace)
  if (!ws) return []
  return workspaceTree(s, ws.machine || '').find(w => w.workspace.id === workspace)?.tabs.filter(e => e.panes.length) || []
}

// Onglet voisin de `tab` dans son space (précédent, sinon suivant), null s'il est seul.
export function neighborTab(s: State, tab: string): string | null {
  const ws = s.panes.find(p => p.tab === tab)?.workspace ?? s.tabs?.find(t => t.id === tab)?.workspace
  if (!ws) return null
  const tabs = liveTabs(s, ws)
  const i = tabs.findIndex(e => e.tab.id === tab)
  if (i < 0) return null
  return (tabs[i - 1] ?? tabs[i + 1])?.tab.id ?? null
}

// Vue d'un onglet : le pane s'il est seul, sinon l'onglet (plan, côte à côte).
const landOn = (tab: string, panes: Pick<Pane, 'id'>[]): Landing => (panes.length === 1 ? { pane: panes[0]!.id } : { tab })

export function afterClose(s: State, closing: Closing, viewed: Viewed | null): Landing {
  if (!viewed) return null
  const vPane = 'pane' in viewed ? s.panes.find(p => p.id === viewed.pane) : undefined
  const vTab = 'tab' in viewed ? viewed.tab : vPane?.tab
  const vWs = vPane?.workspace ?? s.panes.find(p => p.tab === vTab)?.workspace
  if ('workspace' in closing) return vWs === closing.workspace ? 'home' : null
  const toNeighbor = (tab: string): Landing => {
    const n = neighborTab(s, tab)
    return n ? landOn(n, s.panes.filter(p => p.tab === n)) : 'home'
  }
  if ('tab' in closing) return vTab === closing.tab ? toNeighbor(closing.tab) : null
  const p = s.panes.find(x => x.id === closing.pane)
  if (!p || vTab !== p.tab) return null
  // Un autre pane de l'onglet est ouvert : il reste.
  if (vPane && vPane.id !== p.id) return null
  const rest = (tabEntry(s, p.tab)?.panes || []).filter(x => x.id !== p.id)
  if (!rest.length) return toNeighbor(p.tab)
  // Plan ou côte à côte de plusieurs panes : on y reste.
  if ('tab' in viewed && rest.length > 1) return null
  return landOn(p.tab, rest)
}

// Mémoire mise à jour, bornée aux spaces encore ouverts (`open`) s'ils sont connus.
export function rememberTab(memory: TabMemory, workspace: string, tab: string, open?: string[]): TabMemory {
  const next: TabMemory = { ...memory, [workspace]: tab }
  if (!open) return next
  const keep = new Set(open)
  return Object.fromEntries(Object.entries(next).filter(([w]) => keep.has(w)))
}

// ------------------------------------------------------------ miroir
// Taille à demander à `herdr terminal session observe` pour voir un pane tel
// qu'il est : l'observateur rogne ce qui dépasse sa largeur et laisse vide le
// reste (le texte revient à la ligne à la largeur du vrai terminal). Herdr ne
// donne que le nombre de lignes du terminal : la largeur est estimée par excès
// (ligne la plus longue de l'écran — la règle horizontale d'un agent en fait
// toute la largeur —, sinon la case de la disposition).
export function mirrorSize(o: { rows?: number | null, text?: string | null, rect?: { width: number, height: number } | null }) {
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(v)))
  const longest = Math.max(0, ...String(o.text || '').split('\n').map(l => [...l.replace(/\s+$/, '')].length))
  return {
    cols: clamp(Math.max(longest, o.rect?.width || 0, 20), 20, 300),
    rows: clamp(o.rows || o.rect?.height || 24, 5, 200),
  }
}

// Frappes d'un miroir interactif (données de xterm.js) -> envois à Herdr :
// texte tel quel, touches spéciales par leur nom (`pane.send_input`), les
// séquences que Herdr ne sait pas nommer étant ignorées.
export type MirrorInput = { text: string } | { keys: string[] }
const SEQ: Record<string, string> = {
  '\r': 'enter', '\n': 'enter', '\x7f': 'backspace', '\b': 'backspace', '\t': 'tab', '\x1b': 'esc',
  '\x1b[A': 'up', '\x1b[B': 'down', '\x1b[C': 'right', '\x1b[D': 'left',
  '\x1bOA': 'up', '\x1bOB': 'down', '\x1bOC': 'right', '\x1bOD': 'left', '\x1b[Z': 'shift+tab',
  '\x1bOP': 'f1', '\x1bOQ': 'f2', '\x1bOR': 'f3', '\x1bOS': 'f4',
}
// Une séquence d'échappement complète (CSI, SS3) ou Alt+caractère.
const ESC_RE = /^\x1b(?:\[[0-9;?]*[ -/]*[@-~]|O[@-~]|[^[O])?/
export function mirrorInput(data: string): MirrorInput[] {
  const out: MirrorInput[] = []
  const key = (k: string) => {
    const last = out[out.length - 1]
    if (last && 'keys' in last && last.keys.length < 32) last.keys.push(k)
    else out.push({ keys: [k] })
  }
  const text = (s: string) => {
    const last = out[out.length - 1]
    if (last && 'text' in last) last.text += s
    else out.push({ text: s })
  }
  // Collage de plusieurs lignes : du texte, retours compris.
  if (data.length > 1 && !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(data)) {
    const body = data.replace(/\r\n?/g, '\n')
    if (body.includes('\n')) return [{ text: body }]
  }
  let i = 0
  while (i < data.length) {
    const c = data[i]!
    if (c === '\x1b') {
      const m = ESC_RE.exec(data.slice(i))![0]
      if (SEQ[m]) key(SEQ[m])
      else if (m.length === 2 && m[1]! >= ' ' && m[1]! <= '~') key(`alt+${m[1]!.toLowerCase()}`)
      i += m.length
      continue
    }
    if (SEQ[c]) key(SEQ[c])
    else if (c < ' ') { if (c !== '\x00') key(`ctrl+${String.fromCharCode(c.charCodeAt(0) + 96)}`) }
    else text(c)
    i++
  }
  return out
}

// ------------------------------------------------------------ réordonner
// Glisser-déposer d'une carte à l'intérieur de son groupe (même machine, même
// état) : l'ordre d'un groupe est celui de Herdr, donc déposer une carte entre
// deux voisines la place, dans Herdr, juste avant la voisine du dessous ; en
// bas du groupe, juste après la dernière (avant l'espace qui la suit dans
// Herdr, ou à la fin). Les autres espaces ne bougent pas.

// Ordre Herdr après avoir placé `moving` avant `before` (null : à la fin).
export function applyMove(order: string[], moving: string, before: string | null): string[] {
  const rest = order.filter(id => id !== moving)
  const i = before === null ? -1 : rest.indexOf(before)
  if (i < 0) return [...rest, moving]
  return [...rest.slice(0, i), moving, ...rest.slice(i)]
}

// `order` : espaces de la machine dans l'ordre de Herdr ; `group` : ceux du
// groupe, dans l'ordre affiché ; `slot` : interstice visé (0 = avant la
// première carte, group.length = après la dernière). null : rien ne change.
export function reorderTarget(order: string[], group: string[], moving: string, slot: number): { before: string | null } | null {
  const from = group.indexOf(moving)
  if (from < 0 || !order.includes(moving)) return null
  const rest = group.filter(id => id !== moving)
  const k = Math.max(0, Math.min(rest.length, slot > from ? slot - 1 : slot))
  if (!rest.length) return null
  let before: string | null
  if (k < rest.length) before = rest[k]!
  else {
    const others = order.filter(id => id !== moving)
    before = others[others.indexOf(rest[rest.length - 1]!) + 1] ?? null
  }
  const next = applyMove(order, moving, before)
  return next.every((id, i) => id === order[i]) ? null : { before }
}

// Espaces renumérotés comme Herdr le fera (retour immédiat en attendant son état).
export function reorderWorkspaces<W extends Pick<Workspace, 'id' | 'number'> & { machine?: string }>(list: W[], moving: string, before: string | null): W[] {
  const m = list.find(w => w.id === moving)
  if (!m) return list
  const machine = m.machine || ''
  const order = list.filter(w => (w.machine || '') === machine).sort((a, b) => a.number - b.number).map(w => w.id)
  const rank = new Map(applyMove(order, moving, before).map((id, i) => [id, i + 1]))
  return list.map(w => (rank.has(w.id) ? { ...w, number: rank.get(w.id)! } : w))
}
