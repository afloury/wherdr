// Processes an agent leaves behind. Ending an agent ends its terminal's whole
// process tree and every process group in it (groupTargets): a test runner's
// shells re-parented to init keep their group. A sweep finds the rest by the
// mark every agent's process inherits (orphanTargets): CLAUDE_CODE_TMPDIR set to
// its task's `.wherdr-tmp` (agentEnv), never by its folder alone, which an app
// or daemon of the user's may share. macOS hides the environment of its own
// binaries (sh, zsh, bash, sleep): those go with a marked leftover they are
// under or in the group of, or, re-parented to init, by their folder.
import { TMP_DIR } from './run'
import { underRoot } from './cleanup'

// unread: an environment macOS would not show (cwd then read too).
export interface Proc { pid: number, ppid: number, pgid: number, age: number, comm: string, tmp?: string, unread?: true, cwd?: string }

const MARK = 'CLAUDE_CODE_TMPDIR='
// Lines `p<pid>`, `P<ppid>`, `g<pgid>`, `t<elapsed>`, `c<command>`, then with
// $1 = env `e<its CLAUDE_CODE_TMPDIR>` for the processes that have one (ps -E
// on macOS, /proc/<pid>/environ on Linux, where every process of the user's
// is read); on macOS, `u` for an environment not shown (no HOME or PATH) and
// `n<folder>` (lsof -F, as peaks.ts).
export const PROCS_SCRIPT = `ps -A -o pid=,ppid=,pgid=,etime=,comm= | awk '{c=$5; for(i=6;i<=NF;i++) c=c" "$i; print "p"$1; print "P"$2; print "g"$3; print "t"$4; print "c"c}'
[ "$1" = env ] || exit 0
if [ "$(uname -s)" = Darwin ]; then ps -A -wwE -o pid=,command= 2>/dev/null | awk '{v=""; r=0; for(i=2;i<=NF;i++) {if (index($i,"${MARK}")==1) v=substr($i,${MARK.length + 1}); if (index($i,"HOME=")==1 || index($i,"PATH=")==1) r=1}; print "p"$1; if (v!="") print "e"v; if (!r) print "u"}'
  lsof -a -d cwd -Fpn 2>/dev/null || true
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
    else if (k === 'u') cur.unread = true
    else if (k === 'n') cur.cwd = v
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

const INIT = new Set(['launchd', 'systemd', 'init'])
// The system's own binaries, whose environment macOS hides (sh, zsh, sleep, cat).
const SYSTEM_BIN = /^\/(usr\/)?(s?bin|libexec)\/[^/]+$/

// Per task, the leftovers under `root` (the pm worktrees folder) of a task
// with no live agent (or a removed one), never `keep`:
// - a process marked with its `.wherdr-tmp`, wherever it runs;
// - an unmarked one under such a process or in its process group;
// - a system binary whose environment macOS hides, in its worktree and
//   re-parented to init (or a subreaper), with all it started.
// An unmarked process whose environment can be read (the user's apps,
// daemons, editors) or that a terminal app holds (the user's shell) is never
// touched on its own.
export function orphanTargets(procs: Proc[], root: string, live: (task: string) => boolean, keep: number[] = []): Leftovers[] {
  const base = `${root.replace(/\/+$/, '')}/`, by = new Map(procs.map(p => [p.pid, p])), kids = children(procs)
  const idIn = (path: string | undefined, tmpOnly: boolean) => {
    if (!path || !underRoot(path, root)) return undefined
    const [id, tmp, ...rest] = path.slice(base.length).replace(/\/+$/, '').split('/')
    if (tmpOnly && (tmp !== TMP_DIR || rest.length)) return undefined
    return id && !live(id) ? id : undefined
  }
  const owner = new Map<number, string>()
  for (const p of procs) {
    const parent = by.get(p.ppid)
    const detached = p.ppid <= 1 || (!!parent && INIT.has(parent.comm.split('/').pop()!))
    const id = p.tmp ? idIn(p.tmp, true) : p.unread && detached && SYSTEM_BIN.test(p.comm) ? idIn(p.cwd, false) : undefined
    if (id) owner.set(p.pid, id)
  }
  const groups = new Map([...owner].map(([pid, id]) => [by.get(pid)!.pgid, id] as const).filter(([g]) => g > 1))
  for (const [pid, id] of [...owner]) for (const d of tree(kids, pid)) if (!by.get(d)!.tmp && !owner.has(d)) owner.set(d, id)
  for (const p of procs) if (!p.tmp && !owner.has(p.pid) && groups.has(p.pgid)) owner.set(p.pid, groups.get(p.pgid)!)
  const out = new Map<string, Proc[]>()
  for (const [pid, id] of owner) if (!keep.includes(pid)) out.set(id, [...(out.get(id) ?? []), by.get(pid)!])
  return [...out].map(([task, ps]) => ({ task, pids: ps.map(p => p.pid).sort((a, b) => a - b), age: Math.max(...ps.map(p => p.age)) }))
}

// '6 h', '12 min', '40 s': the log's "killed 7 leftover processes, 6 h old".
export const ageText = (s: number) => s >= 3600 ? `${Math.round(s / 3600)} h` : s >= 60 ? `${Math.round(s / 60)} min` : `${s} s`
