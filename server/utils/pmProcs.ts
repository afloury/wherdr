// No process outlives its agent (shared/pm/procs.ts decides which): ending an
// agent kills its terminal's tree and process groups on its machine, and a
// sweep at start and every few minutes kills what is left in the worktrees of
// tasks with no live agent, one line in the task's log each time.
import { dirname } from 'node:path'
import { KILL_SCRIPT, PROCS_SCRIPT, ageText, groupTargets, orphanTargets, parseProcs } from '../../shared/pm/procs'
import { taskPaths } from '../../shared/pm/run'
import { homeOf } from './coreCreate'
import { exec, runOn, type PmLaunchDeps } from './pmLaunch'

type Deps = Pick<PmLaunchDeps, 'call'>

// Ends a terminal and every process it started: its shell's pid read first
// (killing the terminal re-parents them), TERM then KILL after 3 s. Throws
// what terminal.kill throws, the processes killed all the same.
export async function killTerminal(deps: Deps, terminal: string) {
  const on = terminal.includes('/') ? terminal.split('/')[0] : undefined // the address's machine
  const pid = (await deps.call<{ pid?: number }>('terminal.get', { terminal }, 3000).catch(() => null))?.pid
  const ps = typeof pid === 'number' ? await exec(deps, on, PROCS_SCRIPT, [], undefined, 15).catch(() => null) : null
  const pids = ps?.code === 0 ? groupTargets(parseProcs(ps.out), pid!) : []
  try { await deps.call('terminal.kill', { terminal }, 15000) }
  finally { if (pids.length) await exec(deps, on, KILL_SCRIPT, pids.map(String), undefined, 15).catch(() => {}) }
}

// Leftover processes killed per machine since wherdr started (Settings › Machines).
const killed = new Map<string, number>()
export const leftoversKilled = (machine: string) => killed.get(machine) ?? 0

// Every machine a task ran on: its processes in a task worktree whose task has
// no live agent (or is gone) go.
export async function sweepOrphans(deps: PmLaunchDeps) {
  const { store } = deps
  if (!(await store.enabled())) return
  const runs = await store.runs()
  const live = new Set(runs.filter(r => r.state !== 'ended').map(r => r.task))
  for (const machine of new Set(runs.map(r => r.machine))) {
    let on: string | undefined
    try { on = runOn(deps, { machine }) } catch { continue }
    const home = await homeOf(deps, on).catch(() => '')
    if (!home) continue
    const ps = await exec(deps, on, PROCS_SCRIPT, ['cwd'], undefined, 30).catch(() => null)
    if (ps?.code !== 0) continue
    const found = orphanTargets(parseProcs(ps.out), dirname(taskPaths(home, 'x').worktree), id => live.has(id), machine ? [] : [process.pid])
    for (const f of found) {
      if ((await exec(deps, on, KILL_SCRIPT, f.pids.map(String), undefined, 15).catch(() => null))?.code !== 0) continue
      killed.set(machine, leftoversKilled(machine) + f.pids.length)
      const task = await store.task(f.task)
      const n = f.pids.length
      if (task) await store.logTask(task, 'engine', `killed ${n} leftover process${n === 1 ? '' : 'es'}, ${ageText(f.age)} old`)
      else console.warn(`[pm] killed ${n} leftover processes of removed task ${f.task}`)
    }
  }
}
