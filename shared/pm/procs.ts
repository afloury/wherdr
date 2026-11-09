// Processes an agent leaves behind. Ending an agent ends its terminal's whole
// process tree and every process group in it (groupTargets): a test runner's
// shells re-parented to init keep their group. A sweep finds the rest by the
// mark every agent's process inherits (orphanTargets): CLAUDE_CODE_TMPDIR set to
// its task's `.wherdr-tmp` (agentEnv), never by its folder alone, which an app
// or daemon of the user's may share.
import { TMP_DIR } from './run'

export interface Proc { pid: number, ppid: number, pgid: number, age: number, comm: string, tmp?: string }

const MARK = 'CLAUDE_CODE_TMPDIR='
// Lines `p<pid>`, `P<ppid>`, `g<pgid>`, `t<elapsed>`, `c<command>`, then with
// $1 = env `e<its CLAUDE_CODE_TMPDIR>` for the processes that have one (ps -E
// on macOS, /proc/<pid>/environ on Linux; a process whose environment cannot
// be read has none).
export const PROCS_SCRIPT = `ps -A -o pid=,ppid=,pgid=,etime=,comm= | awk '{c=$5; for(i=6;i<=NF;i++) c=c" "$i; print "p"$1; print "P"$2; print "g"$3; print "t"$4; print "c"c}'
[ "$1" = env ] || exit 0
if [ "$(uname -s)" = Darwin ]; then ps -A -wwE -o pid=,command= 2>/dev/null | awk '{for(i=2;i<=NF;i++) if (index($i,"${MARK}")==1) v=substr($i,${MARK.length + 1}); if (v!="") {print "p"$1; print "e"v}; v=""}'
else grep -a -z -o -m1 '^${MARK}.*' /proc/[0-9]*/environ 2>/dev/null | tr '\\0' '\\n' | awk '{f=$0; sub(":.*","",f); gsub("[^0-9]","",f); print "p"f; print "e"substr($0, index($0,"=")+1)}'; fi`

// TERM, then KILL for those still there after 3 s.
export const KILL_SCRIPT = `kill -TERM "$@" 2>/dev/null
for i in 1 2 3 4 5 6; do a=; for p; do kill -0 "$p" 2>/dev/null && a=1; done; [ -z "$a" ] && exit 0; sleep 0.5; done
kill -KILL "$@" 2>/dev/null; exit 0`

// ps's elapsed time, [[dd-]hh:]mm:ss → seconds.
export function seconds(etime: string) {
  const [d, rest] = etime.includes('-') ? etime.split('-') : ['0', etime]
  return (rest ?? '').split(':').reduce((s, x) => s * 60 + Number(x), 0) + Number(d) * 86400
}

export function parseProcs(text: string): Proc[] {
  const out = new Map<number, Proc>()
  let cur: Proc | undefined
  for (const line of text.split('\n')) {
    const k = line[0], v = line.slice(1).trim()
    if (k === 'p') {
      const pid = Number(v)
      cur = out.get(pid) ?? { pid, ppid: 0, pgid: 0, age: 0, comm: '' }
      out.set(pid, cur)
    }
    else if (!cur) continue
    else if (k === 'P') cur.ppid = Number(v)
    else if (k === 'g') cur.pgid = Number(v)
    else if (k === 't') cur.age = seconds(v) || 0
    else if (k === 'c') cur.comm = v
    else if (k === 'e') cur.tmp = v
  }
  return [...out.values()].filter(p => p.pid > 1 && p.comm)
}

const children = (procs: Proc[]) => {
  const m = new Map<number, Proc[]>()
  for (const p of procs) m.set(p.ppid, [...(m.get(p.ppid) ?? []), p])
  return m
}
function tree(kids: Map<number, Proc[]>, pid: number, out = new Set<number>()) {
  if (out.has(pid)) return out
  out.add(pid)
  for (const c of kids.get(pid) ?? []) tree(kids, c.pid, out)
  return out
}

// The pids to end with the terminal whose shell is `root`: its tree, and every
// process of a group one of them is in, but never the group of herdr-core (the
// shell's parents) nor init.
export function groupTargets(procs: Proc[], root: number): number[] {
  const by = new Map(procs.map(p => [p.pid, p]))
  if (!by.has(root)) return []
  const above = new Set<number>()
  for (let p = by.get(by.get(root)!.ppid); p && !above.has(p.pgid); p = by.get(p.ppid)) above.add(p.pgid)
  const mine = tree(children(procs), root)
  const groups = new Set([...mine].map(pid => by.get(pid)!.pgid).filter(g => g > 1 && !above.has(g)))
  return procs.filter(p => mine.has(p.pid) || groups.has(p.pgid)).map(p => p.pid).sort((a, b) => a - b)
}

export interface Leftovers { task: string, pids: number[], age: number }

// Per task, the leftovers under `root` (the pm worktrees folder): every
// process marked with the `.wherdr-tmp` of a task with no live agent (or a
// removed one), wherever it runs and whoever its parent is; never `keep`. A
// process without the mark (the user's shell, editor, an app or daemon started
// in a worktree) is never touched.
export function orphanTargets(procs: Proc[], root: string, live: (task: string) => boolean, keep: number[] = []): Leftovers[] {
  const base = `${root.replace(/\/+$/, '')}/`, out = new Map<string, Proc[]>()
  for (const p of procs) {
    const [id, tmp, ...rest] = p.tmp?.startsWith(base) ? p.tmp.slice(base.length).replace(/\/+$/, '').split('/') : []
    if (!id || tmp !== TMP_DIR || rest.length || id === '.' || id === '..' || live(id) || keep.includes(p.pid)) continue
    out.set(id, [...(out.get(id) ?? []), p])
  }
  return [...out].map(([task, ps]) => ({ task, pids: ps.map(p => p.pid).sort((a, b) => a - b), age: Math.max(...ps.map(p => p.age)) }))
}

// '6 h', '12 min', '40 s': the log's "killed 7 leftover processes, 6 h old".
export const ageText = (s: number) => s >= 3600 ? `${Math.round(s / 3600)} h` : s >= 60 ? `${Math.round(s / 60)} min` : `${s} s`
