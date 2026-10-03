// Global thread limit per machine, across all herdr-projects projects.
// herdr-projects only knows `max_parallel_threads` per project: wherdr keeps a
// limit per machine (Settings › Plugins › herdr-projects), counts the open
// threads of every project from the live panes, shows it on the "In queue"
// list and writes it for the coordinators (`<root>/.wherdr-limits.json`).
// Pure functions, tested in tests/threadLimits.test.ts.
import type { TestLang } from './projectBoard'

export const MAX_THREAD_LIMIT = 99
export const LIMITS_FILE = '.wherdr-limits.json'

// Limits as saved: machine key ('' = local) -> 1…99. Unknown machines and
// invalid values are dropped; a missing machine has no global limit.
export type ThreadLimits = Record<string, number>

export function validLimit(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= MAX_THREAD_LIMIT
}

export function cleanThreadLimits(raw: unknown, keys?: string[]): ThreadLimits {
  const out: ThreadLimits = {}
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out
  for (const [key, v] of Object.entries(raw as Record<string, unknown>)) {
    if (keys && !keys.includes(key)) continue
    if (validLimit(v)) out[key] = v
  }
  return out
}

// Input field of the setting: empty = no limit, otherwise a whole number.
export function parseLimitInput(text: string): number | null | undefined {
  const v = text.trim()
  if (!v) return null
  if (!/^\d+$/.test(v)) return undefined
  const n = Number(v)
  return validLimit(n) ? n : undefined
}

// ---------------------------------------------------------------- open threads
// herdr-projects marks the pane of an open thread with
// `hp_group = <slug>!1!<rank>!t-NNNN` (coordinator: `<slug>!0!<pane>`, a pane
// detached from its project: `~!…`). Without any `hp_group` token (older
// plugin, ticker stopped), an agent pane named `hp-<slug>-t-NNNN` still counts.
const GROUP_THREAD = /^([a-z0-9][a-z0-9._-]*)!1!\d+!(t-\d{4,})$/i
const NAME_THREAD = /^hp-(.+?)-(t-\d{4,})(?:-|$)/i

export function threadOfPane(tokens: unknown, name: string | null | undefined, agent: string | null | undefined): string | null {
  const t = tokens && typeof tokens === 'object' ? tokens as Record<string, unknown> : {}
  const group = typeof t.hp_group === 'string' ? t.hp_group.trim() : ''
  if (group) {
    const g = GROUP_THREAD.exec(group)
    return g ? `${g[1]!.toLowerCase()}/${g[2]!.toLowerCase()}` : null
  }
  const n = agent && name ? NAME_THREAD.exec(name) : null
  return n ? `${n[1]!.toLowerCase()}/${n[2]!.toLowerCase()}` : null
}

export interface SlotMachine { key: string, baseKey?: string, label: string }
export interface MachineSlots {
  key: string // base machine key ('' = local)
  label: string
  open: number // open threads, all projects
  max: number | null // null: no global limit
  free: number | null
  threads: string[] // "<slug>/t-NNNN", sorted
}

// A thread whose agent has finished (idle or done) gives its slot back right
// away, even while its pane waits for review: only working, blocked or
// starting agents hold the machine. An agent born less than STARTING_MS ago
// still counts while idle, waiting for its brief.
export const STARTING_MS = 3 * 60000
export interface SlotPane { machine?: string, hpThread?: string, agent?: string | null, status?: string | null, bornAt?: number }

// One entry per machine (named sessions count with their machine): the
// distinct active threads whose pane lives there.
export function machineSlots(
  panes: SlotPane[],
  machines: SlotMachine[],
  limits: ThreadLimits,
  now = Date.now(),
): MachineSlots[] {
  const base = new Map(machines.map(m => [m.key, m.baseKey ?? m.key]))
  const threads = new Map<string, Set<string>>()
  for (const p of panes) {
    if (!p.hpThread) continue
    const finished = p.agent && (p.status === 'idle' || p.status === 'done') && !(p.bornAt && now - p.bornAt < STARTING_MS)
    if (finished) continue
    const key = base.get(p.machine || '') ?? (p.machine || '')
    if (!threads.has(key)) threads.set(key, new Set())
    threads.get(key)!.add(p.hpThread)
  }
  return machines.filter(m => (m.baseKey ?? m.key) === m.key).map((m) => {
    const list = [...(threads.get(m.key) || [])].sort()
    const max = validLimit(limits[m.key]) ? limits[m.key]! : null
    return { key: m.key, label: m.label, open: list.length, max, free: max === null ? null : Math.max(0, max - list.length), threads: list }
  })
}

// ---------------------------------------------------------------- file for coordinators
export interface LimitsFile {
  updated: string
  // This machine's label: the coordinator reading the file runs here.
  this: string
  machines: Record<string, { max: number | null, open: number, free: number | null, threads: string[] }>
  note: string
}

export function limitsFile(slots: MachineSlots[], selfKey: string, now: Date = new Date()): LimitsFile {
  const self = slots.find(s => s.key === selfKey)
  return {
    updated: now.toISOString(),
    this: self?.label || '',
    machines: Object.fromEntries(slots.map(s => [s.label, { max: s.max, open: s.open, free: s.free, threads: s.threads }])),
    note: 'Written by wherdr. Before starting a thread, check machines[this].free: 0 means the machine is full, wait even if the project still has slots. max null: no global limit. Fallback: herdr-projects overview.',
  }
}

// Content without the date: the file is rewritten only when it changes.
export const limitsSignature = (f: LimitsFile) => JSON.stringify({ ...f, updated: '' })

// ---------------------------------------------------------------- display
// Line of the "In queue" header for the coordinator's machine:
// "2 of 2 thread slots in use on Server (all projects) · full".
export function machineSlotsLine(s: Pick<MachineSlots, 'label' | 'open' | 'max'> | null | undefined, lang: TestLang = 'fr'): string | null {
  if (!s || !(s.max && s.max > 0)) return null
  const full = s.open >= s.max
  if (lang === 'en') {
    const head = `${s.open} of ${s.max} thread slot${s.max === 1 ? '' : 's'} in use on ${s.label} (all projects)`
    return full ? `${head} · full: the queue waits` : head
  }
  const head = `${s.open} place${s.open > 1 ? 's' : ''} de thread sur ${s.max} occupée${s.open > 1 ? 's' : ''} sur ${s.label} (tous projets)`
  return full ? `${head} · pleine : la file attend` : head
}
