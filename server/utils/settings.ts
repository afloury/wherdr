// Settings that follow the user across devices (shared/settings.ts): one
// file in the data folder, written atomically, one write at a time. Every
// change is pushed to the open apps over /ws/events.
import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { applySettingsPatch, cleanSettings, type SettingsMap, type SettingsPatch } from '../../shared/settings'
import { DATA_DIR } from './env'

export const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json')

type Listener = (changed: SettingsPatch) => void
const listeners = new Set<Listener>()
export function onSettingsChange(fn: Listener) {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

export async function readSettings(file = SETTINGS_FILE): Promise<SettingsMap> {
  try {
    const raw = JSON.parse(await fs.readFile(file, 'utf8'))
    return cleanSettings(raw?.settings)
  } catch { return {} }
}

async function writeSettings(settings: SettingsMap, file: string) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  const temp = `${file}.${randomUUID()}.tmp`
  try {
    await fs.writeFile(temp, JSON.stringify({ v: 1, settings }) + '\n', { mode: 0o600 })
    await fs.rename(temp, file)
  } catch (error) {
    await fs.rm(temp, { force: true }).catch(() => {})
    throw error
  }
}

// Writes one after another: two devices changing settings at the same time
// each get their keys in; for the same key, the last one to arrive wins.
let queue: Promise<unknown> = Promise.resolve()

export function patchSettings(patch: SettingsPatch, opts: { onlyMissing?: boolean, file?: string } = {}): Promise<SettingsMap> {
  const file = opts.file || SETTINGS_FILE
  const run = queue.then(async () => {
    const { next, changed } = applySettingsPatch(await readSettings(file), patch, opts.onlyMissing)
    if (!Object.keys(changed).length) return next
    await writeSettings(next, file)
    for (const fn of listeners) {
      try { fn(changed) }
      catch { /* a listener's failure does not undo the write */ }
    }
    return next
  })
  queue = run.catch(() => {})
  return run
}
