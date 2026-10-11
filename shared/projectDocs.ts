// Settings and Memory tabs of the Project panel, both read-only. Pure
// functions, tested in tests/projectDocs.test.ts.
// Checked against herdr-projects 0.2.34: no command prints a project's
// settings (`set` only changes one) or its memory, so wherdr reads what the
// plugin itself reads:
//  - settings: the TOML front matter of PROJECT.md (between `+++` lines), the
//    keys `herdr-projects set` knows, with the plugin's defaults for absent
//    ones. Safety settings live elsewhere and are never read;
//  - memory: MEMORY.md (the index, one `- [title](memory/file.md): what it
//    holds` line per file) and the `memory/*.md` files.
import { tomlStrings } from './projectInbox'

// ---------------------------------------------------------------- settings
export interface ProjectRepo { path: string, machine: string }
export interface ProjectSettings {
  name: string
  goal: string
  coordinatorProfile: string
  threadProfile: string
  maxParallelThreads: number
  autoResolveDays: number
  nudge: boolean
  mute: boolean
  repos: ProjectRepo[]
  // Keys absent from PROJECT.md: the value shown is the plugin's default.
  defaults: SettingKey[]
}
export type SettingKey = 'name' | 'goal' | 'coordinatorProfile' | 'threadProfile' | 'maxParallelThreads' | 'autoResolveDays' | 'nudge' | 'mute'

const front = (md: string) => /^\+\+\+\r?\n([\s\S]*?)\r?\n\+\+\+/.exec(String(md || ''))?.[1] ?? null
// Start of a TOML table: the plain keys before it end there.
const TABLE = /^[ \t]*\[/m
const cut = (s: string | undefined, max: number) => (s || '').replace(/\s+/g, ' ').trim().slice(0, max)

// null: no front matter (not a herdr-projects PROJECT.md).
export function parseProjectSettings(projectMd: string): ProjectSettings | null {
  const f = front(projectMd)
  if (f === null) return null
  // Plain keys first, then the `[[repos]]` tables. Spaces are matched within a
  // line only (`[ \t]`, never `\s`): with the `m` flag, `^\s*` walks every run
  // of blank lines again from each of its lines, seconds for a 32 KB file.
  const parts = f.replace(/\r\n?/g, '\n').split(/^[ \t]*\[\[[ \t]*repos[ \t]*\]\][ \t]*$/m)
  const top = parts[0]!.split(TABLE)[0]!
  const strings = tomlStrings(top)
  const raw = (key: string) => new RegExp(`^[ \\t]*${key}[ \\t]*=[ \\t]*([^\\s#]+)[ \\t]*(?:#.*)?$`, 'm').exec(top)?.[1]
  const defaults: SettingKey[] = []
  const pick = <T>(key: SettingKey, value: T | undefined, fallback: T): T => {
    if (value !== undefined) return value
    defaults.push(key)
    return fallback
  }
  const int = (key: string) => { const v = raw(key); return v !== undefined && /^\d{1,6}$/.test(v) ? Number(v) : undefined }
  const bool = (key: string) => { const v = raw(key); return v === 'true' ? true : v === 'false' ? false : undefined }
  const settings: ProjectSettings = {
    name: cut(pick('name', strings.name, ''), 200),
    goal: cut(pick('goal', strings.goal, ''), 2000),
    // `*_agent`: the keys' names before profiles.
    coordinatorProfile: cut(pick('coordinatorProfile', strings.coordinator_profile ?? strings.coordinator_agent, 'claude'), 60),
    threadProfile: cut(pick('threadProfile', strings.thread_profile ?? strings.thread_agent, 'claude'), 60),
    maxParallelThreads: pick('maxParallelThreads', int('max_parallel_threads'), 10),
    autoResolveDays: pick('autoResolveDays', int('auto_resolve_days'), 7),
    nudge: pick('nudge', bool('nudge'), true),
    mute: pick('mute', bool('mute'), false),
    repos: parts.slice(1, 51).map((p) => {
      const t = tomlStrings(p.split(TABLE)[0]!)
      return { path: cut(t.path, 1024), machine: cut(t.machine, 120) }
    }).filter(r => r.path),
    defaults,
  }
  return settings
}

// ---------------------------------------------------------------- memory
export const MEMORY_INDEX = 'MEMORY.md'
// A file of `memory/`: a plain `.md` name, never a path or a hidden file.
export const MEMORY_FILE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}\.md$/
export const memoryFileOk = (name: unknown): name is string => typeof name === 'string' && MEMORY_FILE_RE.test(name) && !name.includes('..')

export interface MemoryFile {
  name: string // file name in memory/ (or MEMORY.md, the index)
  title: string // from the index, else the file name
  hook: string // what it holds, from the index
  index?: boolean
  missing?: boolean // listed in the index, no such file
}

// Index lines: `- [title](memory/file.md): what it holds` (the hook may also
// follow a dash). Other lines are ignored.
export function parseMemoryIndex(indexMd: string): { name: string, title: string, hook: string }[] {
  const out: { name: string, title: string, hook: string }[] = []
  for (const line of String(indexMd || '').replace(/\r\n?/g, '\n').split('\n')) {
    const m = /^\s*[-*+]\s+\[([^\]]+)\]\((?:\.\/)?memory\/([^)\s]+)\)\s*(?:[:—–-]\s*)?(.*)$/.exec(line)
    if (!m || !memoryFileOk(m[2]) || out.some(x => x.name === m[2])) continue
    out.push({ name: m[2], title: cut(m[1], 160), hook: cut(m[3], 400) })
  }
  return out
}

// The Memory tab's list: the index first (when it exists), then the files the
// index lists, in its order, then the files it does not mention, by name.
export function memoryFiles(indexMd: string | null, names: string[]): MemoryFile[] {
  const files = names.filter(memoryFileOk)
  const listed = parseMemoryIndex(indexMd || '')
  const out: MemoryFile[] = []
  if (indexMd !== null) out.push({ name: MEMORY_INDEX, title: MEMORY_INDEX, hook: '', index: true })
  for (const l of listed) out.push(files.includes(l.name) ? l : { ...l, missing: true })
  for (const name of files.filter(n => !listed.some(l => l.name === n)).sort()) out.push({ name, title: name, hook: '' })
  return out
}
