// Where a task starts: the machine among its project's allowed ones where it
// fits now, or a hold that names each machine's reason. Pure: the server reads
// each machine (capacity, settings, agents at work, readiness, pace) and asks.
import type { MachineCapacity } from './capacity'
import { SWAP_MAX, agentCap, type MemorySettings } from './memory'
import { WEIGHT_DEFAULTS, type Weight } from './weight'

export interface Estimate { mb: number, cores: number }

export interface Candidate {
  key: string
  label: string
  online: boolean
  wait?: string // why it takes no task now, whatever the room: not ready, its account paced
  capacity: MachineCapacity | null // null: not read
  settings: MemorySettings
  running: Estimate[] // the agents at work on it, every project
}

// best: where a start that must go (the user's) goes when nothing fits.
export type Placement = { machine: string } | { hold: string, best?: string }

const HEAVY_LOAD = 0.8 // heavy work waits while the 1-minute load per core is over this
const gb = (mb: number) => `${(mb / 1024).toFixed(1)} GB`
const sum = (xs: Estimate[], k: keyof Estimate) => xs.reduce((n, x) => n + x[k], 0)

// The memory a machine has left for one more task: the least of what it reads
// free and what its agents' estimates leave, both above its minimum free.
// Infinity when it cannot be read.
export function roomOf(c: Candidate) {
  const m = c.capacity
  if (!m) return Infinity
  return Math.min(m.available, m.total - sum(c.running, 'mb')) - c.settings.minFreeMb
}

// Why the task does not fit the machine now, or undefined. Two checks: the live
// reading (catches what wherdr does not track) and the bookkeeping of the
// agents' estimates (an agent started seconds ago has not reached its peak).
export function misfit(c: Candidate, weight: Weight, e: Estimate): string | undefined {
  if (!c.online) return 'offline'
  if (c.wait) return c.wait
  const m = c.capacity
  const agents = c.running.length
  // The user's cap, else one agent per 1.5 GB of RAM (as Settings › Machines shows it).
  const cap = agentCap(c.settings, m)
  if (cap !== undefined && agents >= cap) return `${agents} agents (cap ${cap})`
  if (!m) return undefined
  if (m.available - e.mb < c.settings.minFreeMb) return `${gb(m.available)} free`
  if (m.swapTotal && (m.swapTotal - m.swapFree) / m.swapTotal > SWAP_MAX) return `swap ${Math.round((m.swapTotal - m.swapFree) / m.swapTotal * 100)} % used`
  if (sum(c.running, 'mb') + e.mb > m.total - c.settings.minFreeMb) return `${agents} agents take ≈${gb(sum(c.running, 'mb'))} of ${gb(m.total)}`
  if (m.cores && sum(c.running, 'cores') + e.cores > m.cores) return `${agents} agents take its ${m.cores} cores`
  if (weight === 'heavy' && m.cores && m.load1 / m.cores > HEAVY_LOAD) return `load ${m.load1.toFixed(1)} on ${m.cores} cores`
}

// Most room first, then most cores, then fewest agents.
const stronger = (a: Candidate, b: Candidate) =>
  roomOf(b) - roomOf(a) || (b.capacity?.cores ?? 0) - (a.capacity?.cores ?? 0) || a.running.length - b.running.length

// pinned: the machine the task must go to (its own once started, or the one
// asked for); otherwise the candidates are the project's allowed machines.
// Heavy work goes to the strongest machine that fits; light and standard work
// stays home when it fits, else goes to the one with most room.
export function placeTask({ weight, estimate = WEIGHT_DEFAULTS[weight], home, pinned, candidates }: {
  weight: Weight, estimate?: Estimate, home: string, pinned?: string, candidates: Candidate[]
}): Placement {
  const pool = pinned === undefined ? candidates : candidates.filter(c => c.key === pinned)
  const why = new Map(pool.map(c => [c.key, misfit(c, weight, estimate)]))
  const fits = pool.filter(c => !why.get(c.key))
  const homeFirst = weight !== 'heavy' && fits.find(c => c.key === home)
  const pick = homeFirst || [...fits].sort(stronger)[0]
  if (pick) return { machine: pick.key }
  // Nothing fits: the machine a start that must go takes, home when it has as much room.
  const usable = pool.filter(c => c.online && !c.wait).sort(stronger)
  const top = usable[0], h = usable.find(c => c.key === home)
  const best = pinned ?? (h && top && roomOf(h) >= roomOf(top) ? h.key : top?.key)
  const label = (c: Candidate) => c.label || 'this host'
  if (pinned !== undefined && !pool[0]?.online) return { hold: `Waits for ${pool[0] ? label(pool[0]) : pinned} (offline)`, best }
  const reasons = pool.map(c => `${label(c)}: ${why.get(c.key)}`).join('; ')
  return { hold: `Waits for room: ${weight} (≈${gb(estimate.mb)}) fits nowhere — ${reasons}`, ...(best !== undefined ? { best } : {}) }
}
