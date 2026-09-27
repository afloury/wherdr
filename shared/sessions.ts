import { createHash } from 'node:crypto'
import type { NamedSession } from './types'

export const validSession = (name: string) => /^[\w.-]{1,64}$/.test(name) && name !== '.' && name !== '..'

export function sessionKey(baseKey: string, name: string): string {
  return createHash('sha256').update(`${baseKey}\0${name}`).digest('hex').slice(0, 16)
}

export function parseSessionList(raw: string, baseKey: string, baseSession: string): NamedSession[] {
  let data: unknown
  try { data = JSON.parse(raw) } catch { return [] }
  const rows = (data as { sessions?: unknown })?.sessions
  if (!Array.isArray(rows)) return []
  const seen = new Set<string>()
  const out: NamedSession[] = []
  for (const row of rows as Record<string, unknown>[]) {
    const name = typeof row?.name === 'string' ? row.name : ''
    if (!validSession(name) || seen.has(name)) continue
    seen.add(name)
    out.push({ name, running: row.running === true, key: name === baseSession ? baseKey : sessionKey(baseKey, name) })
  }
  return out.sort((a, b) => (a.name === baseSession ? -1 : b.name === baseSession ? 1 : a.name.localeCompare(b.name)))
}
