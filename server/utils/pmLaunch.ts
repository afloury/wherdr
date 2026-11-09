// Starts a task's worker through herdr-core, on its project's machine: a git
// worktree, the instructions file, then a terminal labelled wherdr.* running
// the agent with its model pinned, DISABLE_AUTOUPDATER=1 and its temp files in
// the worktree (agentEnv). Nothing is ever
// started twice blindly: the run is saved before the terminal, and a restart
// finds it again by its labels (reconcileRuns).
import { projectPlace } from '../../shared/pm/places'
import { randomBytes, randomUUID } from 'node:crypto'
import { CoreError } from './core'
import { HerdrError } from './herdr'
import { PATH_SETUP, homeOf, kindsOf, launchFailure, machineOn, type CoreAdminDeps } from './coreCreate'
import type { PmStore } from './pmStore'
import { noteBack } from './pmStall'
import { initialState, onEvent } from '../../shared/pm/steps'
import { doneSection, runFiles } from '../../shared/pm/advance'
import { isPublic } from '../../shared/pm/visibility'
import { cloneOn, taskMachine } from '../../shared/pm/project'
import { ensureVisibility, readLeakCheck } from './pmVisibility'
import { DEPS_SCRIPT, depsNote } from './pmDeps'
import { ensureReady } from './pmReady'
import { branchFor } from '../../shared/pm/branchName'
import { LABEL, TMP_DIR, agentEnv, agentLine, isAuthFailure, instructionsText, shotStep, taskBase, taskPlan, reconcile, runLabels, taskPaths, tmpRefusal, workerPlan, type LabelledTerminal, type Run, type Task } from '../../shared/pm/run'

// Reuses the worktree of an earlier attempt; else a new branch from the base,
// origin's as fetched now when origin has it (a local one may be stale: a
// chained task needs the task merged before it; and with no local one, git
// would check out a new local base branch instead of the task's), not
// tracking it: the agent's git status must not read as being on the base. Records where the
// branch started (its fork from the base), once: verify counts only the
// commits made on it since.
export const WORKTREE_SCRIPT = `repo=$1 dir=$2 branch=$3 base=$4
[ -e "$dir/.git" ] && exit 0
mkdir -p "$(dirname "$dir")" || exit 1
from=$base
if [ -n "$base" ] && git -C "$repo" rev-parse -q --verify "refs/remotes/origin/$base" >/dev/null; then
  git -C "$repo" fetch -q origin "$base" 2>/dev/null; from=origin/$base; fi
if git -C "$repo" rev-parse -q --verify "refs/heads/$branch" >/dev/null; then git -C "$repo" worktree add "$dir" "$branch" 2>&1
else git -C "$repo" worktree add --no-track -b "$branch" "$dir" \${from:+"$from"} 2>&1 && base=HEAD; fi || exit 1
k="branch.$branch.wherdrstart"
[ -z "$base" ] || git -C "$repo" config "$k" >/dev/null || git -C "$repo" config "$k" "$(git -C "$dir" merge-base HEAD "$base")"`
// The agents' temp folder in the worktree ($2 under $1), ignored through the
// repository's info/exclude (shared by its worktrees); prints the KB free in /tmp.
export const TMP_SCRIPT = `dir=$1 name=$2
mkdir -p "$dir/$name" || exit 1
x=$(git -C "$dir" rev-parse --git-path info/exclude) || exit 1
case $x in /*) ;; *) x=$dir/$x;; esac
if ! grep -qxF "/$name/" "$x" 2>/dev/null; then
  mkdir -p "$(dirname "$x")" || exit 1
  [ -s "$x" ] && [ -n "$(tail -c1 "$x")" ] && echo >> "$x"
  printf '/%s/\\n' "$name" >> "$x" || exit 1
fi
df -Pk /tmp | awk 'NR==2 {print $4}'`
export const WRITE_SCRIPT = 'mkdir -p "$(dirname "$1")" && cat > "$1"'
// Makes the temp folder: why the agent may not start, or undefined.
export async function prepareTmp(deps: Pick<CoreAdminDeps, 'call'>, on: string | undefined, worktree: string) {
  const r = await exec(deps, on, TMP_SCRIPT, [worktree, TMP_DIR])
  const why = r.code !== 0 ? `Could not make the agents' temp folder ${TMP_DIR} in the worktree` : tmpRefusal(r.out)
  if (why) console.warn(`[pm] ${worktree}: ${why}`)
  return why
}
const NOT_FOUND = '127' // the shell found no such program: starting again cannot help

export async function exec(deps: Pick<CoreAdminDeps, 'call'>, on: string | undefined, script: string, args: string[], input?: string, timeout = 60) {
  const r = await deps.call<{ code: number | null, stdout: string, stderr?: string, timed_out?: boolean }>('machine.exec', {
    argv: ['sh', '-c', script, 'sh', ...args], ...(on ? { on } : {}), timeout,
    ...(input !== undefined ? { input: Buffer.from(input).toString('base64') } : {}),
  }, (timeout + 10) * 1000)
  const text = (b?: string) => Buffer.from(b || '', 'base64').toString('utf8').trim()
  return { code: r.timed_out ? null : r.code, out: text(r.stdout), err: text(r.stderr) }
}

// origin: the address the user reached wherdr at (the start request's).
export interface PmLaunchDeps extends CoreAdminDeps { store: PmStore, origin?: string }

// Where an agent reaches wherdr: on wherdr's own machine, loopback; elsewhere,
// the app's address (APP_URL), else the one the user started the task from.
export function wherdrBase(machine: string, origin = '', appUrl = process.env.APP_URL || '', port = process.env.NITRO_PORT || process.env.PORT || '3000') {
  if (!machine) return `http://127.0.0.1:${port}`
  return (appUrl || origin).replace(/\/+$/, '')
}

// The herdr-core target of the machine a run is on (undefined: the wherdr
// host). Everything done for a started task goes there, never to the project's
// machine. Throws when that machine is unknown or unreachable.
export const runOn = (deps: CoreAdminDeps, run: Pick<Run, 'machine'>) => machineOn(deps, run.machine).on

// The task and role of each agent being started now: a second start of the
// same one, from anywhere (user, coordinator, the engine's chain, a held start,
// a revive), is refused while the first runs, never run beside it.
const starting = new Set<string>()
export async function oneStart<T>(task: string, role: Run['role'], fn: () => Promise<T>): Promise<T> {
  const key = `${task}\u0000${role}`
  if (starting.has(key)) throw new HerdrError('busy', `The ${role} of ${task} is already starting`)
  starting.add(key)
  try { return await fn() } finally { starting.delete(key) }
}

// A worker run of the task whose terminal still runs: a new one would share its worktree.
async function liveWorker(deps: PmLaunchDeps, id: string) {
  for (const r of (await deps.store.runs()).filter(x => x.task === id && x.role === 'worker' && x.state !== 'ended' && x.terminal)) {
    const st = await deps.call<{ state?: string }>('terminal.get', { terminal: r.terminal }, 3000).catch(() => null)
    if (st && st.state !== 'finished') return r
  }
}

const wait = (store: PmStore, task: Task, reason: string, waitKind?: Task['waitKind']) => store.saveTask({ ...task, state: 'waiting', waiting: reason, waitKind, held: undefined })

// Starts the worker of a task to do (or waiting, to try again). Any reason it
// cannot start puts the task in 'waiting' with that reason, after one attempt.
// handover: a note for a worker that takes up a stopped task (stop.ts). A
// stopped task stays stopped until its agent starts: never seen as a failure meanwhile.
// revive: the worker the engine released (release.ts) starts again in its
// worktree, whatever the task's state and the holder of its current step.
// on: the machine key a new task goes to (one its project allows); a started
// task always goes back to its own (taskMachine).
// by: who starts it (the log's 'back to work' line, when that clears a timeout or a stall).
type StartOpts = { handover?: string, revive?: true, on?: string, by?: string }
export async function startTask(deps: PmLaunchDeps, id: unknown, opts: StartOpts = {}): Promise<Task> {
  return oneStart(String(id), 'worker', () => startOnce(deps, id, opts))
}

async function startOnce(deps: PmLaunchDeps, id: unknown, { handover, revive, on: asked, by = 'engine' }: StartOpts): Promise<Task> {
  const { store } = deps
  const asRead = await store.task(id)
  if (!asRead) throw new HerdrError('not_found', 'Unknown task')
  let task = asRead
  if (task.state === 'working' && !revive) throw new HerdrError('busy', 'This task is already working')
  const found = (await store.projects()).find(x => x.key === asRead.project)
  if (!found) throw new HerdrError('not_found', 'Unknown project')
  const placed = taskMachine(task, found, asked)
  if ('refused' in placed) throw new HerdrError('refused', placed.refused)
  if (found.git === false) return wait(store, task, 'The project folder is not a git repository: a task needs git for its own worktree')
  const p = await ensureVisibility(deps, found)
  const t = p ? await store.workflow(p.key) : null
  if (!t) return wait(store, task, `The project has no workflow: start it from a template in ${projectPlace(task.project, 'workflow')}`)
  const plan = workerPlan(t, task)
  if ('reason' in plan) return wait(store, task, plan.reason)
  // Stopped at a step the worker does not hold (the review): no new worker. That
  // step's holder is told again (the reviewer started again) by the next advance pass.
  const s = task.step
  const held = s?.started && !s.done ? taskPlan(t, task, p)[s.at] : undefined
  if (held && held.holder !== 'worker' && !revive) {
    const { told: _told, ...step } = s!
    const saved = await store.saveTask({ ...task, state: 'working', waiting: undefined, waitKind: undefined, stopped: undefined, held: undefined, step })
    return noteBack(store, saved, taskPlan(t, saved, p), by, `started again by the ${by}`)
  }
  // Only where a worker is launched: a running one would share its worktree.
  const live = await liveWorker(deps, task.id)
  if (live) throw new HerdrError('busy', `This task's worker is still running (${live.program} ${live.model}): stop the task first`)
  const { machine } = placed
  let on: string | undefined, label = ''
  try { ({ on, m: { label } } = machineOn(deps, machine)) } catch (e) { return wait(store, task, (e as Error).message) }
  if (!(await kindsOf(deps, on)).includes(plan.program)) return wait(store, task, `${plan.program} is not installed on ${label}`)
  const home = await homeOf(deps, on)
  if (!home) return wait(store, task, `${label}: home folder not found`)
  const repo = cloneOn(p, machine, home)
  if (!repo) return wait(store, task, `wherdr knows no clone of the project on ${label}: allow that machine again in the project's settings`)
  // A new task on another machine than home: refused (left as it was) while that machine is not ready.
  if (task.machine === undefined && !task.run && machine !== p.machine) await ensureReady(deps, p, t, task, machine, repo)
  // Named at the first start (a task started before has task/<id>): a later title, tag or template change leaves it alone.
  const paths = taskPaths(home, task.id, task.branch || (task.run ? undefined : branchFor(p.branchName, task)))
  // Recorded at the first start: changing the project's branch later leaves this task alone.
  const base = taskBase(task, p) ?? ''
  const wt = await exec(deps, on, WORKTREE_SCRIPT, [repo, paths.worktree, paths.branch, base])
  if (wt.code !== 0) return wait(store, task, `git worktree failed: ${wt.out.split('\n').slice(-3).join(' ') || 'timeout'}`)
  // Its worktree is there now: the task stays on this machine.
  if (task.machine !== machine) task = await store.saveTask({ ...task, machine })
  const tmpWhy = await prepareTmp(deps, on, paths.worktree)
  if (tmpWhy) return wait(store, task, tmpWhy)
  // A copy of a large node_modules on a cold disk can take minutes.
  const depsLine = depsNote((await exec(deps, on, DEPS_SCRIPT, [repo, paths.worktree], undefined, 300).catch(() => ({ out: '' }))).out)
  // A visual task: the worker's key to upload its screenshots, kept with the task.
  const shotToken = shotStep(t, task.type) ? task.shotToken || randomBytes(16).toString('hex') : undefined
  const leakCheck = isPublic(p) ? (await readLeakCheck(deps, on, paths).catch(() => ({ check: undefined }))).check : undefined
  const text = instructionsText(p, t, task, paths, shotToken ? { base: wherdrBase(machine, deps.origin), token: shotToken } : undefined, leakCheck)
    + ['', ...(depsLine ? [depsLine, ''] : []), ...(handover ? [handover] : []), ...doneSection(runFiles(paths.instructions).note)].join('\n')
  if ((await exec(deps, on, WRITE_SCRIPT, [paths.instructions], text)).code !== 0) return wait(store, task, 'Could not write the instructions file')

  // The engine's start: the task enters its first step (the worker's); the
  // instructions file already tells the worker what to do.
  // Its first step's text is in the instructions file: told already.
  const first = onEvent(taskPlan(t, task, p), initialState(), { kind: 'start' }, Date.now()).state
  const step = task.step?.started ? task.step : { ...first, told: first.since }
  const install = await store.install()
  let run: Run = { id: randomUUID().replace(/-/g, '').slice(0, 12), task: task.id, role: 'worker', ...plan, machine, ...paths, attempt: 1, state: 'starting', startedAt: Date.now() }
  for (;;) {
    await store.saveRun(run) // the receipt, before the terminal exists
    await store.saveTask({ ...task, state: 'working', waiting: undefined, waitKind: undefined, stopped: undefined, held: undefined, run: run.id, step, base, branch: paths.branch, branchStart: task.branchStart ?? paths.branch, ...(shotToken ? { shotToken } : {}) })
    let address: string
    try {
      address = (await deps.call<{ address: string }>('terminal.run', {
        cwd: paths.worktree, ...(on ? { on } : {}), no_parent: true, wait: false,
        env: agentEnv(paths.worktree), labels: runLabels(install, run),
        line: `${PATH_SETUP}; ${agentLine(plan.program, plan.model, paths.instructions)}`,
      }, 30000)).address
    } catch (e) {
      // Unconfirmed: it may run anyway. The next reconciliation finds it by its labels.
      if (e instanceof CoreError && ['timeout', 'disconnected', 'protocol'].includes(e.kind)) return (await store.task(task.id))!
      await store.saveRun({ ...run, state: 'ended', endedBy: 'exit' })
      return wait(store, task, `herdr-core refused to start ${plan.program}: ${(e as Error).message}`)
    }
    run = { ...run, terminal: address, state: 'running', startedAt: Date.now() }
    await store.saveRun(run)
    const failed = await launchFailure(deps, address, deps.launchWatchMs ?? 5000)
    if (!failed) {
      const now = (await store.task(task.id))!
      return task.step?.started ? noteBack(store, now, taskPlan(t, now, p), by, `started again by the ${by}`) : now
    }
    await store.saveRun({ ...run, state: 'ended', endedBy: 'exit' })
    // An agent that exits at once gets one more attempt, never a loop.
    if (run.attempt > 1 || failed.code === NOT_FOUND)
      return wait(store, task, `${plan.program} stopped right after starting (exit code ${failed.code}). Last output:\n${failed.lines || '(none)'}`, isAuthFailure(failed.lines) ? 'auth' : undefined)
    run = { ...run, id: randomUUID().replace(/-/g, '').slice(0, 12), terminal: undefined, attempt: 2, state: 'starting' }
  }
}

// After a restart: unfinished runs find their terminal by wherdr.run. Found =
// it goes on; ended or gone while wherdr was stopped = the task waits, with why.
export async function reconcileRuns(deps: PmLaunchDeps) {
  const { store } = deps
  if (!(await store.enabled())) return []
  const install = await store.install()
  const { terminals } = await deps.call<{ terminals: LabelledTerminal[] }>('terminal.list', { all: true, labels: { [LABEL.install]: install } }, 8000)
  const found = reconcile(await store.runs(), terminals, install)
  for (const f of found) {
    const task = await store.task(f.run.task)
    if (f.state === 'running') {
      await store.saveRun({ ...f.run, terminal: f.terminal, state: 'running' })
      if (task && task.run === f.run.id && task.state !== 'working') await store.saveTask({ ...task, state: 'working', waiting: undefined })
      continue
    }
    await store.saveRun({ ...f.run, state: 'ended', endedBy: f.state })
    if (task?.run === f.run.id && task.state === 'working')
      await wait(store, task, f.state === 'exit' ? 'The agent ended while wherdr was stopped' : 'The agent\'s terminal is gone (not found after a restart)')
  }
  return found
}
