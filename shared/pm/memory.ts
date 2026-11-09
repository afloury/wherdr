// Memory-aware starts: an automatic start (a wake, an 'after' chain, an
// automation) on a machine waits while the machine is short on memory, or
// while it already runs as many agents as its cap, across all projects. The
// user's own starts still go, with a word that the machine is short.

import type { MachineCapacity } from './capacity'

// The user's settings for one machine (Settings › Machines).
export interface MemorySettings {
  minFreeMb: number // automatic starts wait while less memory than this is available
  maxAgents?: number // agents at once on the machine; unset: one per MB_PER_AGENT of its RAM
  hours?: Hours // when it is there for automatic starts; unset: always
}

// When a machine is there (a laptop at the office): its days, from and to as
// HH:MM in the server's time (to before from: over midnight, the days are the start's).
export interface Hours { days: 'weekdays' | 'all', from: string, to: string }
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/
const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3))
export const hoursLabel = (h: Hours) => `${h.days === 'weekdays' ? 'weekdays' : 'every day'} ${h.from}-${h.to}`
// Heavy work needs this long before the machine leaves.
export const HEAVY_BEFORE_MIN = 120

// Why an automatic start does not go there at `now`, or undefined: outside its
// hours, or heavy work too close to the end of them.
export function hoursWait(h: Hours | undefined, heavy: boolean, now: Date): string | undefined {
  if (!h) return
  const from = minutes(h.from), to = minutes(h.to), t = now.getHours() * 60 + now.getMinutes()
  const span = (to - from + 1440) % 1440 || 1440
  const since = (t - from + 1440) % 1440 // minutes since its hours began (today or yesterday)
  const day = new Date(now.getTime() - since * 60_000).getDay()
  const inside = since < span && (h.days === 'all' || (day >= 1 && day <= 5))
  if (!inside) return `away (${hoursLabel(h)})`
  if (heavy && span - since < HEAVY_BEFORE_MIN) return `leaves at ${h.to}: too late for heavy work`
}

export const DEFAULT_MEMORY: MemorySettings = { minFreeMb: 2048 }
export const SWAP_MAX = 0.9 // automatic starts wait while more of the swap than this is used
export const MB_PER_AGENT = 1536

// The machine's cap: the user's, else one agent per MB_PER_AGENT of RAM (at least one).
export const agentCap = (s: MemorySettings, mem: MachineCapacity | null) =>
  s.maxAgents ?? (mem ? Math.max(1, Math.floor(mem.total / MB_PER_AGENT)) : undefined)

const gb = (mb: number) => `${(mb / 1024).toFixed(1)} GB`
const swapUsed = (m: MachineCapacity) => (m.swapTotal ? (m.swapTotal - m.swapFree) / m.swapTotal : 0)

// Why the machine is short for one more agent, or undefined. `agents`: the
// agents running on it now, all projects together. An unknown reading holds
// only by the user's cap.
export function memoryShort(mem: MachineCapacity | null, s: MemorySettings, agents: number): string | undefined {
  if (mem && mem.available < s.minFreeMb) return `${gb(mem.available)} free, under ${gb(s.minFreeMb)}`
  if (mem && swapUsed(mem) > SWAP_MAX) return `swap ${Math.round(swapUsed(mem) * 100)} % used`
  const cap = agentCap(s, mem)
  if (cap !== undefined && agents >= cap) return `${agents} agents already run on it (cap ${cap})`
}

// The reading's parts: "5.2 GB free of 16.0 GB", "8 cores, load 2.1", "swap 3 %", "2 of 10 agents".
export function capacityParts(mem: MachineCapacity | null, s: MemorySettings, agents: number): string[] {
  const cap = agentCap(s, mem)
  return [
    mem ? `${gb(mem.available)} free of ${gb(mem.total)}` : 'memory unknown',
    ...(mem?.cores ? [`${mem.cores} cores, load ${mem.load1.toFixed(1)}`] : []),
    ...(mem?.swapTotal ? [`swap ${Math.round(swapUsed(mem) * 100)} %`] : []),
    cap !== undefined ? `${agents} of ${cap} agents` : `${agents} agents`,
  ]
}

// One line for Settings: "5.2 GB free of 16.0 GB · 8 cores, load 2.1 · swap 3 % · 2 of 10 agents · go".
export function memoryLine(mem: MachineCapacity | null, s: MemorySettings, agents: number): string {
  const short = memoryShort(mem, s, agents)
  return [...capacityParts(mem, s, agents), short ? `wait: ${short}` : 'go'].join(' · ')
}

// Whether a machine is there now, for `autopilot show` and Settings: "online · weekdays 09:00-19:00, away now".
export function availabilityLine(online: boolean, h: Hours | undefined, now = new Date()) {
  return [online ? 'online' : 'offline', ...(h ? [`${hoursLabel(h)}${hoursWait(h, false, now) ? ', away now' : ''}`] : [])].join(' · ')
}

// The user's changes, checked over `base`: minFreeGb 0-256 (GB), maxAgents 1-50 or null (back to the default), hours.
export function mergeMemory(base: MemorySettings, patch: unknown): MemorySettings {
  const p = (patch && typeof patch === 'object' ? patch : {}) as Record<string, unknown>
  const out = { ...base }
  if (typeof p.minFreeGb === 'number' && p.minFreeGb >= 0 && p.minFreeGb <= 256) out.minFreeMb = Math.round(p.minFreeGb * 1024)
  if (p.maxAgents === null) delete out.maxAgents
  else if (Number.isInteger(p.maxAgents) && (p.maxAgents as number) >= 1 && (p.maxAgents as number) <= 50) out.maxAgents = p.maxAgents as number
  // hours: null (always there) or { days: 'weekdays' | 'all', from, to: 'HH:MM' }, from ≠ to.
  const h = p.hours as Partial<Hours> | null | undefined
  if (h === null) delete out.hours
  else if (h && (h.days === 'weekdays' || h.days === 'all') && HHMM.test(h.from ?? '') && HHMM.test(h.to ?? '') && h.from !== h.to) out.hours = { days: h.days, from: h.from!, to: h.to! }
  return out
}
