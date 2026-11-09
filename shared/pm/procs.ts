// Processes an agent leaves behind. Ending an agent ends its terminal's whole
// process tree and every process group in it (groupTargets): a test runner's
// shells re-parented to init keep their group. A sweep finds the rest by their
// folder (orphanTargets): a process in the worktree of a task with no live
// agent, detached from any terminal or app, goes.
import { underRoot } from './cleanup'

export interface Proc { pid: number, ppid: number, pgid: number, age: number, comm: string, cwd?: string }

// Lines `p<pid>`, `P<ppid>`, `g<pgid>`, `t<elapsed>`, `c<command>`, then with
// $1 = cwd `n<folder>` (lsof -F on macOS, /proc on Linux; peaks.ts does the same).
export const PROCS_SCRIPT = `ps -A -o pid=,ppid=,pgid=,etime=,comm= | awk '{c=$5; for(i=6;i<=NF;i++) c=c" "$i; print "p"$1; print "P"$2; print "g"$3; print "t"$4; print "c"c}'
[ "$1" = cwd ] || exit 0
if [ "$(uname -s)" = Darwin ]; then lsof -a -d cwd -Fpn 2>/dev/null || true
else find /proc -mindepth 2 -maxdepth 2 -name cwd -printf 'p%h\\nn%l\\n' 2>/dev/null | sed 's|^p/proc/|p|'; fi`

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
    else if (k === 'n') cur.cwd = v.replace(/ \(deleted\)$/, '')
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

const INIT = new Set(['launchd', 'systemd', 'init'])
const isInit = (p: Proc) => INIT.has(p.comm.split('/').pop()!)

export interface Leftovers { task: string, pids: number[], age: number }

// Per task, the leftovers under `root` (the pm worktrees folder): a process
// whose topmost parent below init is itself in the worktree of a task with no
// live agent (or a removed one), with all it started. A user's shell, editor
// or terminal there has a parent outside it (its app): never touched; nor `keep`.
export function orphanTargets(procs: Proc[], root: string, live: (task: string) => boolean, keep: number[] = []): Leftovers[] {
  const by = new Map(procs.map(p => [p.pid, p]))
  const taskOf = (p: Proc) => {
    if (!p.cwd || !underRoot(p.cwd, root) || p.cwd === root) return undefined
    const id = p.cwd.slice(root.replace(/\/$/, '').length + 1).split('/')[0]!
    return id && !live(id) ? id : undefined
  }
  const kids = children(procs), out = new Map<string, Set<number>>()
  for (const top of procs) {
    const task = taskOf(top)
    // A top: its parent is init (re-parented), or a subreaper like systemd --user.
    const parent = by.get(top.ppid)
    if (!task || (top.ppid > 1 && !(parent && isInit(parent)))) continue
    const pids = out.get(task) ?? new Set<number>()
    for (const pid of tree(kids, top.pid)) if (!keep.includes(pid)) pids.add(pid)
    out.set(task, pids)
  }
  return [...out].filter(([, pids]) => pids.size).map(([task, pids]) => ({
    task, pids: [...pids].sort((a, b) => a - b), age: Math.max(...[...pids].map(pid => by.get(pid)!.age)),
  }))
}

// '6 h', '12 min', '40 s': the log's "killed 7 leftover processes, 6 h old".
export const ageText = (s: number) => s >= 3600 ? `${Math.round(s / 3600)} h` : s >= 60 ? `${Math.round(s / 60)} min` : `${s} s`
