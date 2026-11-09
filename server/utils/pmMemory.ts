// A machine's memory for automatic starts (shared/pm/memory.ts): its
// capacity (shared/pm/capacity.ts, Linux or macOS) through herdr-core (read at most every 20 s), the agents
// running on it across all projects, and the user's settings, kept in
// DATA_DIR/machine-memory.json by machine key ('' = the wherdr host).
import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { DEFAULT_MEMORY, agentCap, mergeMemory, memoryLine, memoryShort, memoryWait, type MemorySettings } from '../../shared/pm/memory'
import { CAPACITY_SCRIPT, parseCapacity, type MachineCapacity } from '../../shared/pm/capacity'
import { machineOn, type CoreAdminDeps } from './coreCreate'
import { exec } from './pmLaunch'
import type { PmStore } from './pmStore'
import { DATA_DIR } from './env'
import { agentsAtWork } from '../../shared/pm/release'
import { taskPlan } from '../../shared/pm/run'

export const MEMORY_FILE = path.join(DATA_DIR, 'machine-memory.json')

export async function readMemorySettings(file = MEMORY_FILE): Promise<Record<string, MemorySettings>> {
  try {
    const raw = JSON.parse(await fs.readFile(file, 'utf8'))?.machines
    return Object.fromEntries(Object.entries(raw && typeof raw === 'object' ? raw : {}).map(([k, v]) => [k, mergeMemory(DEFAULT_MEMORY, v && typeof v === 'object' ? { minFreeGb: (v as MemorySettings).minFreeMb / 1024, maxAgents: (v as MemorySettings).maxAgents } : {})]))
  } catch { return {} }
}

let queue: Promise<unknown> = Promise.resolve()
export function setMemorySettings(key: string, patch: unknown, file = MEMORY_FILE): Promise<MemorySettings> {
  const run = queue.then(async () => {
    const all = await readMemorySettings(file)
    const s = all[key] = mergeMemory(all[key] ?? DEFAULT_MEMORY, patch)
    await fs.mkdir(path.dirname(file), { recursive: true })
    const temp = `${file}.${randomUUID()}.tmp`
    try {
      await fs.writeFile(temp, JSON.stringify({ v: 1, machines: all }) + '\n', { mode: 0o600 })
      await fs.rename(temp, file)
    } catch (error) {
      await fs.rm(temp, { force: true }).catch(() => {})
      throw error
    }
    return s
  })
  queue = run.catch(() => {})
  return run
}

const read = new Map<string, { at: number, mem: MachineCapacity | null }>()
// Forgets a reading: an agent just started there, its memory is not in it yet.
export const forgetMemory = (machine: string) => read.delete(machine)

async function machineCapacity(deps: CoreAdminDeps, machine: string, now = Date.now()) {
  const hit = read.get(machine)
  if (hit && now - hit.at < 20_000) return hit.mem
  let mem: MachineCapacity | null = null
  try { mem = parseCapacity((await exec(deps, machineOn(deps, machine).on, CAPACITY_SCRIPT, [], undefined, 10)).out) } catch {}
  read.set(machine, { at: now, mem })
  return mem
}

export interface MemoryState { key: string, label: string, mem: MachineCapacity | null, settings: MemorySettings, agents: number, cap?: number, line: string, short?: string }

// The agents at work on a machine, every project: those that hold their task's
// step under way (agentsAtWork), not those of a task that waits for the user.
async function atWork(store: PmStore, machine: string) {
  const [runs, tasks, projects] = await Promise.all([store.runs(), store.tasks(), store.projects()])
  const holders = new Map<string, string | undefined>()
  for (const t of tasks.filter(x => x.step && runs.some(r => r.task === x.id && r.machine === machine && r.state !== 'ended'))) {
    const p = projects.find(x => x.key === t.project), tpl = p && await store.workflow(p.key)
    holders.set(t.id, tpl ? taskPlan(tpl, t, p)[t.step!.at]?.holder : undefined)
  }
  return agentsAtWork(runs, tasks, machine, t => holders.get(t.id))
}

// Where a machine stands: its reading, its settings, its agents at work.
export async function memoryState(deps: CoreAdminDeps & { store: PmStore }, machine: string): Promise<MemoryState> {
  const label = deps.machines().find(m => m.key === machine)?.label ?? machine
  const [mem, all, agents] = await Promise.all([machineCapacity(deps, machine), readMemorySettings(), atWork(deps.store, machine)])
  const settings = all[machine] ?? DEFAULT_MEMORY
  const short = memoryShort(mem, settings, agents)
  const cap = agentCap(settings, mem)
  return { key: machine, label, mem, settings, agents, ...(cap !== undefined ? { cap } : {}), line: memoryLine(mem, settings, agents), ...(short ? { short } : {}) }
}

// Why an automatic start of a task of `project` waits for memory, as its card
// says it, or undefined. A failed read never holds a start.
export async function memoryHold(deps: CoreAdminDeps & { store: PmStore }, project: string): Promise<string | undefined> {
  try {
    const p = (await deps.store.projects()).find(x => x.key === project)
    const s = p && await memoryState(deps, p.machine)
    return s?.short && memoryWait(s.label, s.short)
  } catch { return undefined }
}

// Settings › Machines and › Pace: every machine wherdr reaches.
export const memoryView = async (deps: CoreAdminDeps & { store: PmStore }) =>
  ({ machines: await Promise.all(deps.machines().filter(m => m.local || m.status === 'online').map(m => memoryState(deps, m.key))) })
