// Moves a task inside TASKS.md, written by wherdr itself (Project panel):
// one place up or down in its list, or to the "To do" / "In queue" list.
// Only the task's lines move (its line and its indented detail lines); every
// other byte of the file stays as it was. Pure functions, tested in
// tests/taskEdit.test.ts. The server checks that the file has not changed
// since the app read it (shared hash) before applying the result.
import { type ListKind, listKind, parseTaskLine } from './projectBoard'

export type TaskMove = 'up' | 'down' | 'todo' | 'queue'
export const TASK_MOVES: TaskMove[] = ['up', 'down', 'todo', 'queue']

// The task the app shows: list index in file order (ProjectBoard.lists), task
// index in that list, and its text, checked against the file.
export interface TaskRef { list: number, index: number, text: string }

export type TaskEditError = 'not_found' | 'no_list' | 'edge' | 'same_list'
export type TaskEditResult = { ok: true, text: string } | { ok: false, error: TaskEditError }

const MAX_LINE = 2000
interface Block { start: number, end: number, text: string } // lines [start, end)
interface IndexedList { kind: ListKind | null, heading: number, tasks: Block[] }

// Same rules as parseTasks (fences, `##` headings, `#` ends a list, indented
// lines are details), with line numbers.
function headingTitle(raw: string): string | null {
  if (!raw.startsWith('##') || !/\s/.test(raw[2] ?? '')) return null
  const body = raw.slice(2).trim()
  if (!body) return null
  return body.replace(/#+$/, '').trim() || body[0]!
}
const isFence = (l: string) => /^\s*(```|~~~)/.test(l)

function indexLists(lines: string[]): IndexedList[] {
  const lists: IndexedList[] = []
  let cur: IndexedList | null = null
  let fence = false
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!
    if (raw.length > MAX_LINE) continue
    if (isFence(raw)) { fence = !fence; continue }
    if (fence) continue
    const title = headingTitle(raw)
    if (title) {
      cur = { kind: listKind(title), heading: i, tasks: [] }
      lists.push(cur)
      continue
    }
    if (/^#\s/.test(raw)) { cur = null; continue }
    if (!cur || /^\s/.test(raw)) continue
    const task = parseTaskLine(raw, cur.kind)
    if (!task) continue
    cur.tasks.push({ start: i, end: blockEnd(lines, i), text: task.text })
  }
  return lists
}

// End of a task's block: the indented lines after it (blank lines between
// two detail lines included, trailing blank lines not), and a fence opened in
// its details up to its closing line.
function blockEnd(lines: string[], start: number): number {
  let end = start + 1
  let fence = false
  for (let j = start + 1; j < lines.length; j++) {
    const l = lines[j]!
    if (fence) {
      if (isFence(l)) fence = false
      end = j + 1
      continue
    }
    if (!l.trim()) continue
    if (!/^\s/.test(l)) break
    if (isFence(l)) fence = true
    end = j + 1
  }
  return end
}

// Lines with their own ending, written back as they are. A last line without
// one borrows the file's ending while lines move, given back at the end.
function splitLines(md: string): { raw: string[], last: string } {
  const raw = md.match(/[^\n]*\n|[^\n]+$/g) || []
  const tail = raw.at(-1)
  if (!tail || tail.endsWith('\n')) return { raw, last: '' }
  const eol = /\r\n/.test(md) ? '\r\n' : '\n'
  raw[raw.length - 1] = tail + eol
  return { raw, last: eol }
}
const joinLines = (lines: string[], last: string) => {
  const out = lines.join('')
  return last && out.endsWith(last) ? out.slice(0, -last.length) : out
}

export function moveTaskInText(md: string, ref: TaskRef, move: TaskMove): TaskEditResult {
  const { raw, last } = splitLines(md)
  const lists = indexLists(raw.map(l => l.replace(/\r?\n$/, '')))
  const list = lists[ref.list]
  const block = list?.tasks[ref.index]
  if (!list || !block || block.text !== ref.text) return { ok: false, error: 'not_found' }
  const piece = raw.slice(block.start, block.end)

  if (move === 'up' || move === 'down') {
    const other = list.tasks[ref.index + (move === 'up' ? -1 : 1)]
    if (!other) return { ok: false, error: 'edge' }
    const [a, b] = move === 'up' ? [other, block] : [block, other]
    return {
      ok: true,
      text: joinLines([...raw.slice(0, a.start), ...raw.slice(b.start, b.end), ...raw.slice(a.end, b.start), ...raw.slice(a.start, a.end), ...raw.slice(b.end)], last),
    }
  }

  const kind: ListKind = move === 'todo' ? 'todo' : 'queue'
  if (list.kind === kind) return { ok: false, error: 'same_list' }
  const dest = lists.find(l => l.kind === kind)
  if (!dest) return { ok: false, error: 'no_list' }
  // Out of the queue: back on top of To do (the coordinator's contract);
  // otherwise at the end of the list.
  const top = move === 'todo' && list.kind === 'queue'
  let at = top
    ? (dest.tasks[0]?.start ?? dest.heading + 1)
    : (dest.tasks.at(-1)?.end ?? dest.heading + 1)
  const rest = [...raw.slice(0, block.start), ...raw.slice(block.end)]
  if (at > block.start) at -= block.end - block.start
  return { ok: true, text: joinLines([...rest.slice(0, at), ...piece, ...rest.slice(at)], last) }
}
