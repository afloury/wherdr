// omp's tool calls as omp's terminal shows them: its own title ("Bash",
// "Grep", "Edit"…), the target (the command, the path with its line range,
// the pattern), the counts it prints ("95 matches", "+3/-2"), the wall time
// and the end of the output. Read from the transcript: the `toolCall` of an
// assistant message, then its `toolResult` message.
import type { OmpToolView } from '../../shared/types'

type Json = any

// Lines of output kept (omp shows the last 10, "… (N earlier lines)").
export const OMP_OUT_LINES = 10
const LINE_MAX = 240
const TARGET_MAX = 600

const TITLES: Record<string, string> = {
  bash: 'Bash', read: 'Read', write: 'Write', edit: 'Edit', ast_edit: 'AST Edit', grep: 'Grep', ast_grep: 'AST Grep',
  glob: 'Glob', find: 'Find', web_search: 'Web Search', fetch: 'Fetch', task: 'Task', todo: 'Todo', wait: 'Wait', ask: 'Ask',
}
const title = (name: string) => TITLES[name] || name.split(/[_-]+/).filter(Boolean).map(w => w[0]!.toUpperCase() + w.slice(1)).join(' ') || 'Tool'

const str = (v: unknown) => (typeof v === 'string' ? v : '')
const clipLine = (l: string) => (l.length > LINE_MAX ? `${l.slice(0, LINE_MAX)}…` : l)
const clip = (s: string, n = TARGET_MAX) => (s.length > n ? `${s.slice(0, n)}…` : s)

// Path as omp prints it: relative to the session's folder, else under "~".
export function ompPath(p: string, cwd = '', home = ''): string {
  if (!p) return ''
  if (cwd && (p === cwd || p.startsWith(`${cwd}/`))) return p.slice(cwd.length + 1) || '.'
  if (home && (p === home || p.startsWith(`${home}/`))) return `~${p.slice(home.length)}`
  return p
}

// Files an edit's hashline input names: "[TASKS.md#DFAB]" or "@path".
function editPaths(input: string): string[] {
  const out: string[] = []
  for (const m of input.matchAll(/^\[([^\]#\n]+)#[0-9A-Fa-f]*\]|^@(\S+)/gm)) {
    const p = (m[1] || m[2] || '').trim()
    if (p && !out.includes(p)) out.push(p)
  }
  return out
}

// The call, before its result.
export function ompToolCall(name: string, args: Json, cwd = '', home = ''): OmpToolView {
  const a = args && typeof args === 'object' ? args : {}
  const p = (v: unknown) => ompPath(str(v), cwd, home)
  const v: OmpToolView = { title: title(name) }
  const intent = str(a.i).trim()
  if (intent) v.intent = intent.split('\n')[0]
  switch (name) {
    case 'bash': v.target = str(a.command).trim(); break
    case 'read': case 'write': v.target = p(a.path); break
    case 'edit': case 'ast_edit': v.target = p(a.path) || editPaths(str(a.input)).join(', '); break
    case 'grep': case 'ast_grep': v.target = str(a.pattern); if (a.path) v.scope = p(a.path); break
    case 'glob': case 'find': v.target = str(a.pattern) || p(a.path) || (Array.isArray(a.paths) ? a.paths.map(p).join(', ') : ''); break
    case 'web_search': v.target = str(a.query); break
    case 'fetch': v.target = str(a.url); break
    default: {
      const k = ['command', 'path', 'pattern', 'query', 'url', 'description', 'title'].find(x => typeof a[x] === 'string' && a[x].trim())
      if (k) v.target = k === 'path' ? p(a[k]) : str(a[k]).split('\n')[0]
    }
  }
  if (v.target) v.target = clip(v.target)
  else delete v.target
  return v
}

// omp appends its own notes to bash's output; it shows them in the frame's
// footer instead ("⟦Wall: 0.09s | Exit: 2⟧").
const BASH_NOTES = /(?:\s*\n)?(?:Wall time: [\d.]+ seconds|Command exited with code -?\d+)\s*$/

const resultText = (m: Json) => (Array.isArray(m.content) ? m.content : [])
  .filter((c: Json) => c && c.type === 'text' && typeof c.text === 'string').map((c: Json) => c.text).join('\n')

// Last `n` lines (bash output, like omp), or the first (an error message).
function excerpt(text: string, n: number, from: 'end' | 'start') {
  const lines = text.replace(/\s+$/, '').split('\n')
  while (lines.length && !lines[0]!.trim()) lines.shift()
  if (!lines.length) return null
  const kept = from === 'end' ? lines.slice(-n) : lines.slice(0, n)
  return { out: kept.map(clipLine).join('\n'), outLines: lines.length }
}

// Completes the call with its result. `startedAt`: when the assistant message
// carrying the call was written (ms), for tools without their own wall time.
export function ompToolResult(v: OmpToolView, name: string, m: Json, startedAt: number | null, cwd = '', home = ''): void {
  const d = m && m.details && typeof m.details === 'object' ? m.details : {}
  let text = resultText(m)
  if (name === 'bash') {
    for (let prev = ''; prev !== text;) {
      prev = text
      text = text.replace(BASH_NOTES, '')
    }
    const code = typeof d.exitCode === 'number' ? d.exitCode : null
    if (code) v.exit = code
  }
  if (typeof d.wallTimeMs === 'number') v.ms = Math.round(d.wallTimeMs)
  else if (typeof m.timestamp === 'number' && startedAt && m.timestamp >= startedAt) v.ms = m.timestamp - startedAt
  if (d.async && typeof d.async.jobId === 'string') {
    // Backgrounded: omp prints the job's id, its output comes later.
    v.job = d.async.jobId
    delete v.ms
  } else if (m.isError) {
    Object.assign(v, excerpt(text, name === 'bash' ? OMP_OUT_LINES : 6, name === 'bash' ? 'end' : 'start'))
  } else if (name === 'bash') {
    Object.assign(v, excerpt(text, OMP_OUT_LINES, 'end'))
  } else if ((name === 'edit' || name === 'ast_edit') && typeof d.diff === 'string') {
    const lines = d.diff.split('\n')
    v.added = lines.filter((l: string) => /^\+\s*\d*\|/.test(l)).length
    v.removed = lines.filter((l: string) => /^-\s*\d*\|/.test(l)).length
    const ex = excerpt(d.diff, 16, 'start')
    if (ex) Object.assign(v, ex, { diff: true })
    if (typeof d.path === 'string' && d.path) v.target = ompPath(d.path, cwd, home)
  }
  if ((name === 'grep' || name === 'ast_grep') && typeof d.matchCount === 'number') {
    v.matches = d.matchCount
    if (typeof d.fileCount === 'number') v.files = d.fileCount
    if (!v.scope && typeof d.scopePath === 'string') v.scope = ompPath(d.scopePath, cwd, home)
  } else if ((name === 'glob' || name === 'find') && typeof d.fileCount === 'number') {
    v.files = d.fileCount
  } else if (name === 'wait' && Array.isArray(d.jobs)) {
    const jobs = d.jobs.filter((j: Json) => j && typeof j.id === 'string')
    if (jobs.length) v.target = clip(jobs.map((j: Json) => `${j.id}${j.label ? ` ${String(j.label).split('\n')[0]}` : ''}`).join(' · '))
  }
}

// What the user ran in omp's input field: "!cmd" / "!!cmd" (bashExecution)
// or "$ code" / "$$ code" (pythonExecution). omp writes the entry once the
// run is over, with no start time: no wall time. A cancelled run's output
// ends with omp's "[Command cancelled]" note, shown as a flag instead.
export function ompUserRun(m: Json): OmpToolView | null {
  const python = m && m.role === 'pythonExecution'
  if (!m || (m.role !== 'bashExecution' && !python)) return null
  const target = str(python ? m.code : m.command).trim()
  if (!target) return null
  const v: OmpToolView = { title: python ? 'Python' : 'Bash', target: clip(target) }
  if (typeof m.exitCode === 'number' && m.exitCode) v.exit = m.exitCode
  if (m.cancelled) v.cancelled = true
  const ex = excerpt(str(m.output).replace(/(?:^|\n)\[Command cancelled\]\s*$/, ''), OMP_OUT_LINES, 'end')
  if (ex) Object.assign(v, ex)
  return v
}

