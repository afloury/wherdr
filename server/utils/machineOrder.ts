import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { DATA_DIR } from './env'
import { baseMachines } from './machines'

const file = path.join(DATA_DIR, 'machine-order.json')

export function currentMachineKeys() { return baseMachines().map(m => m.key) }

export async function readMachineOrder(): Promise<string[]> {
  try {
    const value: unknown = JSON.parse(await fs.readFile(file, 'utf8'))
    if (!Array.isArray(value)) return []
    const known = new Set(currentMachineKeys())
    return value.filter((key, index): key is string => typeof key === 'string' && known.has(key) && value.indexOf(key) === index)
  } catch { return [] }
}

export async function writeMachineOrder(order: string[]): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true })
  const temp = `${file}.${randomUUID()}.tmp`
  try {
    await fs.writeFile(temp, JSON.stringify(order) + '\n', { mode: 0o600 })
    await fs.rename(temp, file)
  } catch (error) {
    await fs.rm(temp, { force: true }).catch(() => {})
    throw error
  }
}
