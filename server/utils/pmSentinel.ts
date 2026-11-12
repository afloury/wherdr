// The engine's liveness (shared/pm/sentinel.ts): one task's error never stops
// the others' pass and is logged on it once; a task the mechanic cannot follow
// says why on its card; and at the end of each mechanic tick, the sentinel
// re-enters every working task that has been quiet with no stated reason.
import { READ_HOLD, SENTINEL_LOG, SENTINEL_MS, isReadHold, seenBy, sentinelDue, sentinelFired } from '../../shared/pm/sentinel'
import { taskPlan, type Task } from '../../shared/pm/run'
import { showIds } from '../../shared/pm/projectKey'
import { actionRunning, stepAction } from './pmBoard'
import { wakeCoordinators } from './pmWakes'
import type { PmLaunchDeps } from './pmLaunch'
import type { PmStore } from './pmStore'

// Task id → the last error or reason logged on it: each said once.
const said = new Map<string, string>()

export async function noteTaskError(store: PmStore, id: string, e: unknown) {
  const text = `the engine hit an error on this task: ${e instanceof Error ? e.message : String(e)}`.slice(0, 400)
  if (said.get(id) === text) return
  said.set(id, text)
  const task = await store.task(id).catch(() => null)
  if (task) await store.logTask(task, 'engine', text).catch(() => {})
}

// Why the mechanic cannot follow a working task this tick, on its card and in
// its log once per reason; no reason: it can again, and its hold goes.
export async function noteCannotFollow(store: PmStore, task: Task, why?: string): Promise<Task> {
  if (!why) {
    if (!isReadHold(task.held)) return task
    said.delete(task.id)
    return store.saveTask({ ...task, held: undefined })
  }
  const held = READ_HOLD + why.slice(0, 300)
  if (task.state !== 'working' || task.held === held) return task
  const log = said.get(task.id) !== held
  said.set(task.id, held)
  return log ? store.logTask({ ...task, held }, 'engine', held) : store.saveTask({ ...task, held })
}

// Handed work whose worker is working right now: someone is on it.
async function agentWorking(deps: PmLaunchDeps, task: Task) {
  if (!task.step?.agent) return false
  const run = (await deps.store.runs()).filter(r => r.task === task.id && r.role === 'worker').sort((a, b) => b.startedAt - a.startedAt)[0]
  if (!run?.terminal || run.state === 'ended') return false
  const st = await deps.call<{ status?: string | { state?: string } }>('terminal.get', { terminal: run.terminal }, 3000).catch(() => null)
  const s = typeof st?.status === 'string' ? st.status : st?.status?.state
  return s === 'working' || s === 'blocked'
}

export interface SentinelOpts {
  ms?: number
  wake?: (task: Task, why: string) => Promise<string[]>
  act?: (id: string) => Promise<Task> // runs the step's action again (stepAction)
}

// Each quiet working task: said, re-entered, looked at again after 2N, 4N…;
// its coordinator woken once per step. Returns the tasks it looked at.
export async function sentinelTick(deps: PmLaunchDeps, now = Date.now(), opts: SentinelOpts = {}) {
  const { store } = deps
  const ms = opts.ms ?? SENTINEL_MS
  const wake = opts.wake ?? ((task: Task, why: string) => wakeCoordinators(deps, task, why, now))
  const act = opts.act ?? ((id: string) => stepAction(deps, id, 'engine'))
  const projects = await store.projects(), fired: string[] = []
  for (const task of await store.tasks()) {
    try {
      const p = projects.find(x => x.key === task.project)
      const t = p ? await store.workflow(p.key).catch(() => null) : null
      if (!p || !t) continue
      const plan = taskPlan(t, task, p)
      const key = sentinelDue(task, plan, now, ms)
      if (!key || actionRunning(task.id) || await agentWorking(deps, task)) continue
      fired.push(task.id)
      const state = sentinelFired(task.sentinel, key, now, ms), s = task.step!
      const sees = seenBy(task, plan)
      let tried: string
      if (s.acting) {
        // Marked running, but nothing runs: run again; refused, the mark goes so the step can move.
        tried = await act(task.id).then(() => 'ran its action again', async (e: Error) => {
          const fresh = (await store.task(task.id))!
          await store.saveTask({ ...fresh, step: { ...fresh.step!, acting: undefined } })
          return `cleared its stale running mark (running it again failed: ${e.message})`
        })
      } else {
        // A merge move spent at this head: given back once, the mechanic makes it again.
        const spent = state.n === 1 ? Object.entries(task.mech ?? {}).filter(([k]) => k.startsWith('merge:')).sort((a, b) => b[1] - a[1])[0]?.[0] : undefined
        if (spent) {
          const fresh = (await store.task(task.id))!
          const { [spent]: _, ...mech } = fresh.mech ?? {}
          await store.saveTask({ ...fresh, mech })
          tried = `gave back its spent move ${spent}: the merge is tried again`
        } else tried = 'found nothing to run again'
      }
      const mins = Math.round(ms / 60_000), again = Math.round((state.next - now) / 60_000)
      const why = `${task.id} (${task.title}): ${SENTINEL_LOG} ${mins} min with no stated reason, ${sees}. The engine ${tried}.`
      const woken = state.woke ? [] : await wake((await store.task(task.id))!, showIds(projects, why))
      const said = state.woke ? '' : woken.length ? ` Woke ${woken.join(' and ')}.` : ' No coordinator to wake.'
      const fresh = (await store.task(task.id))!
      await store.logTask({ ...fresh, sentinel: { ...state, woke: true } }, 'engine', `${SENTINEL_LOG} ${mins} min: ${sees}. It ${tried}; it looks again in ${again} min.${said}`)
    } catch (e) { await noteTaskError(store, task.id, e) }
  }
  return fired
}
