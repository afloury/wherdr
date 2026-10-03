// Global thread limit per machine (Settings › Plugins › herdr-projects):
// limits saved in data/thread-limits.json, open threads counted from the live
// panes of every machine, and `<root>/.wherdr-limits.json` written in each
// herdr-projects root where a coordinator runs, so coordinators can check
// the machine before `thread start`.
import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { HerdrState, Pane } from '../../shared/types'
import { isCoordinator, projectOf } from '../../shared/projects'
import { LIMITS_FILE, type MachineSlots, type ThreadLimits, cleanThreadLimits, limitsFile, limitsSignature, machineSlots } from '../../shared/threadLimits'
import { DATA_DIR, log } from './env'
import { allMachines, baseMachines, getMachine } from './machines'
import { getState, onStateChange } from './state'

const file = path.join(DATA_DIR, 'thread-limits.json')
const WRITE_DELAY_MS = 1500

let cache: ThreadLimits | null = null

export const limitMachineKeys = () => baseMachines().map(m => m.key)

export async function readThreadLimits(): Promise<ThreadLimits> {
  if (!cache) {
    try { cache = cleanThreadLimits(JSON.parse(await fs.readFile(file, 'utf8'))) }
    catch { cache = {} }
  }
  return { ...cache }
}

export async function writeThreadLimits(limits: ThreadLimits): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true })
  const temp = `${file}.${randomUUID()}.tmp`
  try {
    await fs.writeFile(temp, JSON.stringify(limits) + '\n', { mode: 0o600 })
    await fs.rename(temp, file)
  } catch (error) {
    await fs.rm(temp, { force: true }).catch(() => {})
    throw error
  }
  cache = { ...limits }
  scheduleWrite(0)
}

function slotsOf(state: HerdrState, limits: ThreadLimits): MachineSlots[] {
  const machines = allMachines().map(m => m.info()).map(i => ({ key: i.key, baseKey: i.baseKey, label: i.label }))
  return machineSlots(state.panes, machines, limits)
}

export async function currentMachineSlots(): Promise<MachineSlots[]> {
  return slotsOf(getState(), await readThreadLimits())
}

// Base machine of a pane (named sessions belong to their machine).
export function paneBaseMachine(p: Pick<Pane, 'machine'>): string {
  const m = getMachine(p.machine || '')
  return m ? (m.info().baseKey ?? m.key) : (p.machine || '')
}

// herdr-projects roots in use on each machine: the parent of each
// coordinator's project folder (`<root>/<slug>`).
export function coordinatorRoots(panes: Pane[]): Map<string, Set<string>> {
  const roots = new Map<string, Set<string>>()
  for (const p of panes) {
    const cwd = (p.cwd || '').replace(/\/+$/, '')
    const slug = projectOf(p)
    if (!isCoordinator(p) || !slug || !path.posix.isAbsolute(cwd)) continue
    if (path.posix.basename(cwd).toLowerCase() !== slug.toLowerCase()) continue
    const key = paneBaseMachine(p)
    if (!roots.has(key)) roots.set(key, new Set())
    roots.get(key)!.add(path.posix.dirname(cwd))
  }
  return roots
}

// ---------------------------------------------------------------- file for coordinators
const written = new Map<string, string>() // "<machine>|<root>" -> signature
let timer: ReturnType<typeof setTimeout> | null = null
let running = false

async function writeOn(key: string, root: string, text: string): Promise<void> {
  const m = getMachine(key)
  if (!m) return
  const target = path.posix.join(root, LIMITS_FILE)
  if (m.local) {
    const st = await fs.stat(root).catch(() => null)
    if (!st?.isDirectory()) throw new Error(`${root} is not a folder`)
    const temp = `${target}.${randomUUID()}.tmp`
    try {
      await fs.writeFile(temp, text, { mode: 0o644 })
      await fs.rename(temp, target)
    } catch (error) {
      await fs.rm(temp, { force: true }).catch(() => {})
      throw error
    }
    return
  }
  if (!m.exec || m.status !== 'online') return
  const r = await m.exec('[ -d "$1" ] || exit 3; t="$2.$$.tmp"; cat > "$t" && mv "$t" "$2" || { rm -f "$t"; exit 1; }', [root, target], { input: Buffer.from(text), timeoutMs: 10000 })
  if (r.code !== 0) throw new Error(r.stderr.trim() || `code ${r.code}`)
}

export async function syncLimitsFiles(): Promise<void> {
  const state = getState()
  // Partial state at startup: wait for every machine before counting.
  if (!state.ok || state.ready === false) return
  const slots = slotsOf(state, await readThreadLimits())
  for (const [key, roots] of coordinatorRoots(state.panes)) {
    const content = limitsFile(slots, key)
    const sig = limitsSignature(content)
    for (const root of roots) {
      const id = `${key}|${root}`
      if (written.get(id) === sig) continue
      try {
        await writeOn(key, root, JSON.stringify(content, null, 2) + '\n')
        written.set(id, sig)
      } catch (e) {
        // Remembered so an unwritable root is not retried on every change.
        written.set(id, sig)
        log(`thread limits: ${LIMITS_FILE} not written in ${root}: ${(e as Error).message}`)
      }
    }
  }
}

function scheduleWrite(delay = WRITE_DELAY_MS) {
  if (timer) clearTimeout(timer)
  timer = setTimeout(async () => {
    timer = null
    if (running) return scheduleWrite()
    running = true
    try { await syncLimitsFiles() }
    catch (e) { log(`thread limits: ${(e as Error).message}`) }
    finally { running = false }
  }, delay)
  timer.unref?.()
}

let started = false
export function startThreadLimits() {
  if (started) return
  started = true
  onStateChange(() => scheduleWrite())
  scheduleWrite()
}
