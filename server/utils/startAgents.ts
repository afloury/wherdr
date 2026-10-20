// The agents picked on the Board for one start (`delegate --worker.agent`).
// herdr-projects keeps such an option as the task's own setting, and reads it
// again whenever it starts that task's agent (a restart during the run too), so
// it stays while the run lasts. wherdr writes down what it set and what the task
// had before, and puts that back once the run is over or before the next Start
// (server/utils/projectsTasks.ts): the task's default is what it was.
// Kept in DATA_DIR/start-agents.json, so a restart of wherdr does not lose them.
import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { DATA_DIR } from './env'

// `agent`: what wherdr set; `prev`: the task's own worker.agent before (null:
// it had none, its repo's or the user's applied); `at`: when (ms).
export interface StartAgentRecord { agent: string, prev: string | null, at: number }

// Forgotten after this long (a task cleared from the board, say).
const KEEP_MS = 90 * 24 * 3600_000
let records: Map<string, StartAgentRecord> | null = null
let saving: Promise<void> = Promise.resolve()
const file = () => path.join(DATA_DIR, 'start-agents.json')

function clean(v: unknown): Map<string, StartAgentRecord> {
  const out = new Map<string, StartAgentRecord>()
  if (!v || typeof v !== 'object' || Array.isArray(v)) return out
  for (const [k, r] of Object.entries(v as Record<string, unknown>)) {
    const o = r as Record<string, unknown> | null
    if (!o || typeof o.agent !== 'string' || typeof o.at !== 'number') continue
    if (Date.now() - o.at > KEEP_MS) continue
    out.set(k, { agent: o.agent, prev: typeof o.prev === 'string' ? o.prev : null, at: o.at })
  }
  return out
}

async function all(): Promise<Map<string, StartAgentRecord>> {
  if (!records) {
    let read: Map<string, StartAgentRecord>
    try { read = clean(JSON.parse(await fs.readFile(file(), 'utf8'))) }
    catch { read = new Map() }
    records ??= read
  }
  return records
}

function save(): Promise<void> {
  const data = JSON.stringify(Object.fromEntries(records || []), null, 1) + '\n'
  saving = saving.catch(() => {}).then(async () => {
    await fs.mkdir(DATA_DIR, { recursive: true })
    const temp = `${file()}.${randomUUID()}.tmp`
    try {
      await fs.writeFile(temp, data, { mode: 0o600 })
      await fs.rename(temp, file())
    } catch (e) {
      await fs.rm(temp, { force: true }).catch(() => {})
      throw e
    }
  })
  return saving
}

export const startAgentKey = (machine: string, id: string) => `${machine}|${id}`

export async function startAgentOf(key: string): Promise<StartAgentRecord | null> {
  return (await all()).get(key) || null
}
// The records of one machine's board: [task id, record].
export async function startAgentsOf(machine: string): Promise<Array<[string, StartAgentRecord]>> {
  const prefix = `${machine}|`
  return [...(await all())].filter(([k]) => k.startsWith(prefix)).map(([k, r]) => [k.slice(prefix.length), r])
}
export async function rememberStartAgent(key: string, r: StartAgentRecord): Promise<void> {
  (await all()).set(key, r)
  await save()
}
export async function dropStartAgent(key: string): Promise<void> {
  if ((await all()).delete(key)) await save()
}
// Tests start from what the file says.
export function resetStartAgents() { records = null }
