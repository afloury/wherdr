// Settings and Memory tabs of the Project panel, on the coordinator's machine.
// Read-only: no herdr-projects command prints either (shared/projectDocs.ts),
// so the files the plugin itself reads are read: PROJECT.md's front matter,
// MEMORY.md and `memory/*.md`. Nothing is written, no command is run.
import type { Pane } from '../../shared/types'
import { type MemoryFile, type ProjectSettings, MEMORY_INDEX, memoryFileOk, memoryFiles, parseProjectSettings } from '../../shared/projectDocs'
import { HerdrError } from './herdr'
import { type Target, target } from './projectBoard'

const PROJECT_HEAD_BYTES = 32 * 1024
const INDEX_BYTES = 128 * 1024
export const MEMORY_BYTES = 256 * 1024
export const MEMORY_FILES_MAX = 300

type Where = Pick<Target, 'm' | 'dir'>

async function head(t: Where, file: string, max: number): Promise<{ text: string, truncated: boolean } | null> {
  const st = await t.m.fs.stat(file).catch(() => null)
  if (!st || !st.isFile) return null
  const text = (await t.m.fs.read(file, 0, Math.min(st.size, max))).toString('utf8')
  return { text, truncated: st.size > max }
}

export async function settingsOn(t: Where): Promise<{ settings: ProjectSettings }> {
  const file = await head(t, `${t.dir}/PROJECT.md`, PROJECT_HEAD_BYTES)
  const settings = file && parseProjectSettings(file.text)
  if (!settings) throw new HerdrError('no_settings', 'project settings not found')
  return { settings }
}

export async function memoryOn(t: Where): Promise<{ files: MemoryFile[] }> {
  const [index, names] = await Promise.all([
    head(t, `${t.dir}/${MEMORY_INDEX}`, INDEX_BYTES),
    t.m.fs.readdir(`${t.dir}/memory`).catch(() => [] as string[]),
  ])
  return { files: memoryFiles(index ? index.text : null, names.slice(0, MEMORY_FILES_MAX * 4)).slice(0, MEMORY_FILES_MAX) }
}

// One memory file: the index, or a `.md` directly in `memory/`.
export async function memoryFileOn(t: Where, name: unknown): Promise<{ name: string, text: string, truncated: boolean }> {
  if (name !== MEMORY_INDEX && !memoryFileOk(name)) throw new HerdrError('bad_memory', 'invalid memory file')
  const file = await head(t, name === MEMORY_INDEX ? `${t.dir}/${MEMORY_INDEX}` : `${t.dir}/memory/${name}`, MEMORY_BYTES)
  if (!file) throw new HerdrError('no_memory', 'memory file not found')
  return { name: name as string, ...file }
}

async function need(pane: Pane): Promise<Target> {
  const t = await target(pane)
  if (!t) throw new HerdrError('no_project', 'project not found')
  return t
}
export const readProjectSettings = async (pane: Pane) => settingsOn(await need(pane))
export const readProjectMemory = async (pane: Pane) => memoryOn(await need(pane))
export const readMemoryFile = async (pane: Pane, name: unknown) => memoryFileOn(await need(pane), name)
