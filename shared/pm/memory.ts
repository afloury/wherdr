// Memory-aware starts: an automatic start (a wake, an 'after' chain, an
// automation) on a machine waits while the machine is short on memory, or
// while it already runs as many agents as its cap, across all projects. The
// user's own starts still go, with a word that the machine is short.

import type { MachineCapacity } from './capacity'

// The user's settings for one machine (Settings › Machines).
export interface MemorySettings {
  minFreeMb: number // automatic starts wait while less memory than this is available
  maxAgents?: number // agents at once on the machine; unset: one per MB_PER_AGENT of its RAM
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

// One line for `autopilot show` and Settings: "5.2 GB free of 16.0 GB · 8 cores, load 2.1 · swap 3 % · 2 of 10 agents · go".
export function memoryLine(mem: MachineCapacity | null, s: MemorySettings, agents: number): string {
  const cap = agentCap(s, mem)
  const short = memoryShort(mem, s, agents)
  return [
    mem ? `${gb(mem.available)} free of ${gb(mem.total)}` : 'memory unknown',
    ...(mem?.cores ? [`${mem.cores} cores, load ${mem.load1.toFixed(1)}`] : []),
    ...(mem?.swapTotal ? [`swap ${Math.round(swapUsed(mem) * 100)} %`] : []),
    cap !== undefined ? `${agents} of ${cap} agents` : `${agents} agents`,
    short ? `wait: ${short}` : 'go',
  ].join(' · ')
}

// The user's changes, checked over `base`: minFreeGb 0-256 (GB), maxAgents 1-50 or null (back to the default).
export function mergeMemory(base: MemorySettings, patch: unknown): MemorySettings {
  const p = (patch && typeof patch === 'object' ? patch : {}) as Record<string, unknown>
  const out = { ...base }
  if (typeof p.minFreeGb === 'number' && p.minFreeGb >= 0 && p.minFreeGb <= 256) out.minFreeMb = Math.round(p.minFreeGb * 1024)
  if (p.maxAgents === null) delete out.maxAgents
  else if (Number.isInteger(p.maxAgents) && (p.maxAgents as number) >= 1 && (p.maxAgents as number) <= 50) out.maxAgents = p.maxAgents as number
  return out
}
