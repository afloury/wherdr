// Tasks that change the same files do not run at the same time. A task names
// the files or folders it plans to change (its worker writes them to its
// files marker, or the coordinator gives them with `task add --files`), and
// the engine reads what each started task changed (git diff since its branch
// started). A new start that touches what a started task, not done yet,
// touches waits behind it, unless the user starts it anyway. Pure:
// server/utils/pmFiles.ts reads the worktrees and starts the waiting tasks.
import type { Task } from './run'

const MAX = 200

// A path as written ("./app/", "docs/**", "a\\b") → one form: no ./, no trailing / or /**.
const clean = (s: string) => s.trim().replace(/\\/g, '/').replace(/^(\.\/)+/, '').replace(/\/\*{1,2}$/, '').replace(/\/+$/, '')

// A list of paths: one per line or comma-separated; blank lines and # comments left out, each once.
export function parseFiles(text: unknown): string[] {
  const words = Array.isArray(text) ? text.map(String) : typeof text === 'string' ? text.split(/[\n,]/) : []
  const out = words.map(w => w.replace(/#.*$/, '')).map(clean).filter(w => w && w !== '.' && !w.startsWith('../') && w.length <= 300)
  return [...new Set(out)].slice(0, MAX)
}

// The same file, or one inside the other's folder.
const covers = (dir: string, p: string) => p === dir || p.startsWith(`${dir}/`)
export const overlap = (a: string, b: string) => covers(a, b) || covers(b, a)
export const shared = (mine: string[], theirs: string[]) => mine.filter(m => theirs.some(t => overlap(m, t)))

// What a started task touches: what it declared and what it changed.
const footprint = (t: Pick<Task, 'files' | 'changed'>) => [...t.files ?? [], ...t.changed ?? []]

// Still holds its files: started, not done (working, waiting for the user or for its merge, stopped).
const holds = (t: Task) => !!t.step?.started && !t.step.done

// The task a start of `task` waits behind: a started task of the same project
// that touches what `task` declared, with the paths in common. None: it may start.
export function fileConflict(task: Task, tasks: Task[]): { task: string, files: string[] } | undefined {
  const mine = task.files ?? []
  if (!mine.length) return
  for (const other of tasks) {
    if (other.id === task.id || other.project !== task.project || !holds(other)) continue
    const files = shared(mine, footprint(other))
    if (files.length) return { task: other.id, files: files.slice(0, 5) }
  }
}

// The changed files no declared path covers (none declared: nothing to say).
export const beyond = (t: Pick<Task, 'files' | 'changed'>) =>
  t.files?.length ? (t.changed ?? []).filter(c => !t.files!.some(f => covers(f, c))) : []

export const sameFilesText = (id: string) => `Waits for ${id}, same files`

// The worker's section of its instructions file.
export const filesSection = (marker: string, planned?: string[]) => [
  '## Files you change', '',
  `Before you change anything, write the files or folders you plan to change to ${marker}, one per line (a folder covers what is in it).${planned?.length ? ` Planned so far: ${planned.join(', ')}.` : ''}`,
  'Tasks that change the same files do not run at the same time. If you change others later, add them there and say which in your closing note.', '',
]
