// The engine's mechanical moves, every minute (server/plugins/pm.ts): for each
// working or waiting task, the facts (its PR and checks, its agent busy or not,
// a login back), then at most one move (shared/pm/mechanic.ts). A move is
// noted on the task before it runs, so it is never made twice. A move that
// tries to fix a block counts (shared/pm/selfFix.ts): past its tries, or with
// nothing left to try, the coordinator is woken once, with what was tried.
import { randomUUID } from 'node:crypto'
import { CODE, SCRIPT, guardAction, taskGuards, type PrInfo } from '../../shared/pm/actions'
import { CATCH_UP_TRIES, catchUpGaveUp, ciOf, infraLog, nextMove, redCiText, type MechFacts, type Move } from '../../shared/pm/mechanic'
import { FIX_MOVE, blockOf, escalation, fixOf, mayTry, noteFix } from '../../shared/pm/selfFix'
import { enqueue, wakesFor } from '../../shared/pm/wakes'
import { MAIN } from '../../shared/pm/coordinator'
import { inMergeQueue, mergeOrder, ordinal } from '../../shared/pm/mergeQueue'
import { awaitsHolder } from '../../shared/pm/blocked'
import { onEvent, reviewedCommit, waitsToMerge, type PlannedStep, type StepEvent } from '../../shared/pm/steps'
import { LABEL, taskPlan, trustPrompt, waitOf, type LabelledTerminal, type Run, type Task } from '../../shared/pm/run'
import { PATH_SETUP } from './coreCreate'
import { HerdrError } from './herdr'
import { CoreError } from './core'
import { actionShell } from './pmActions'
import { prSeen, stepAction } from './pmBoard'
import { prNow, requiredChecks } from '../../shared/pm/board'
import { exec, runOn, startTask, type PmLaunchDeps } from './pmLaunch'
import { coordinatorStartRefusal } from '../../shared/pm/autopilot'
import { originOf, pacedStart, paceRefusal } from '../../shared/pm/pace'
import { paceOf, placeFor, slotsOf } from './pmPlace'
import { CHAIN_WAIT, chainState } from '../../shared/pm/advance'
import { advanceTick } from './pmAdvance'
import { forgetMemory } from './pmMemory'
import { releaseIdle, reviveWorker } from './pmRelease'
import { agentBack, agentWaits, fixWatch, handToAgent, handedWatch, MACHINE_OFFLINE, retriesAction, type WorkerNow } from '../../shared/pm/release'
import { noteBack, noteStall } from './pmStall'
import { askedQuestion } from './pmRead'

export const LOGIN_SCRIPT = `export DISABLE_AUTOUPDATER=1; case $1 in claude) claude auth status;; codex) codex login status;; *) exit 2;; esac >/dev/null 2>&1`

const lastLine = (out: string) => out.trim().split('\n').pop()?.trim().slice(0, 300) || ''

const WAITS = { question: 'The agent asks a question', permission: 'The agent asks for a permission', auth: 'The agent is not logged in' } as const

// What each running agent waits for, from its terminal (wherdr.report label or
// a permission prompt): its task waits with that kind, and works again once it is gone.
const trusted = new Set<string>() // runs whose trust dialog the engine answered
export async function syncWaits(deps: PmLaunchDeps) {
  const { store } = deps
  const install = await store.install()
  const { terminals } = await deps.call<{ terminals: (LabelledTerminal & { status?: { state?: string, msg?: string } })[] }>('terminal.list', { all: true, labels: { [LABEL.install]: install } }, 8000)
  const runs = await store.runs()
  // A new agent stopped on the folder trust dialog of its own worktree (no status yet): "Yes".
  for (const run of runs.filter(r => r.terminal && r.state !== 'ended' && Date.now() - r.startedAt < 10 * 60_000)) {
    const term = terminals.find(x => x.address === run.terminal)
    if (!term || term.state === 'finished' || term.status?.state || trusted.has(run.id)) continue
    const screen = String((await deps.call<{ text?: string }>('terminal.read', { terminal: run.terminal, lines: 30 }, 3000).catch(() => null))?.text || '')
    if (!trustPrompt(screen, run.worktree)) continue
    trusted.add(run.id)
    await deps.call('terminal.keys', { terminal: run.terminal, keys: ['down', 'enter'] }, 10000).catch(() => {})
    const task = await store.task(run.task)
    if (task) await store.logTask(task, 'engine', `trusted the task's worktree for the ${run.role} (${run.worktree})`)
  }
  for (const task of await store.tasks()) {
    const run = runs.find(r => r.id === task.run)
    const term = run?.terminal && run.state !== 'ended' ? terminals.find(x => x.address === run.terminal) : undefined
    if (!term || term.state === 'finished') continue
    const kind = waitOf(term)
    // What herdr-core says is asked ("approve Bash: npm test"), else the kind.
    const msg = typeof term.status === 'object' ? term.status?.msg?.trim().slice(0, 300) : undefined
    // A question carries its text, for the board and the coordinator's wake.
    const asked = kind === 'question' && task.state === 'working' ? await askedQuestion(deps, run!.terminal!) : undefined
    if (task.state === 'working' && kind) await store.saveTask({ ...task, state: 'waiting', waiting: (kind === 'permission' && msg) || (asked ? `${WAITS.question}: ${asked}` : WAITS[kind]), waitKind: kind })
    else if (task.state === 'waiting' && (task.waitKind === 'question' || task.waitKind === 'permission') && !kind)
      await store.saveTask({ ...task, state: 'working', waiting: undefined, waitKind: undefined })
  }
}

// A task with "after" starts once those tasks are done, within its
// coordinator's autopilot limits and hours (one per tick and project): the
// order is the user's. One of them failed or stopped: it waits for the user, with why.
// Started another way meanwhile (the user, the coordinator): the engine's own start is dropped, not logged as a failure.
const startedElsewhere = (e: Error) => e instanceof HerdrError && e.code === 'busy'

export async function startChained(deps: PmLaunchDeps, now = Date.now()) {
  const { store } = deps
  const tasks = await store.tasks(), runs = await store.runs(), started: string[] = []
  for (const t of tasks.filter(x => x.after && !x.step?.started)) {
    const c = chainState(t, tasks)
    const held = c && c !== 'go' ? c.wait : undefined
    if (t.state === 'todo' && held) await store.logTask({ ...t, state: 'waiting', waiting: held }, 'engine', held)
    // Held by its chain, and the task before it goes on again: to do, the engine starts it once that one is done.
    else if (t.state === 'waiting' && !held && t.waiting?.includes(CHAIN_WAIT)) await store.logTask({ ...t, state: 'todo', waiting: undefined }, 'engine', 'to do again: the tasks before it go on')
  }
  const machines = new Set<string>() // one start per machine and tick: the next reading counts the new agent
  for (const p of await store.projects()) {
    const ap = (await store.coordinator(p.key))?.autopilot
    const mine = (await store.tasks()).filter(t => t.project === p.key)
    // A chain the coordinator or an automation made is automatic work: held by the pace.
    let next: typeof mine[number] | undefined, pace: Awaited<ReturnType<typeof paceOf>> | undefined
    for (const t of mine.filter(x => x.after && x.state === 'todo')) {
      pace = pacedStart(t, 'engine') ? await paceOf(store, p, t, now) : undefined
      if (!coordinatorStartRefusal(ap, t, mine, runs, now, false, { pace: pace?.verdict, engine: true, holds: await slotsOf(store, [p]) })) { next = t; break }
    }
    if (!next) continue
    // No room on any allowed machine: held, with why on its card, until a later tick finds room.
    const placed = await placeFor(deps, next, { waits: pace?.waits })
    if ('hold' in placed) { if (next.held !== placed.hold) await store.logTask({ ...next, held: placed.hold }, 'engine', placed.hold); continue }
    if (machines.has(placed.machine)) continue
    machines.add(placed.machine)
    forgetMemory(placed.machine)
    const r = await startTask(deps, next.id, { on: placed.machine }).catch((e: Error) => startedElsewhere(e) ? null : ({ ...next, state: 'waiting' as const, waiting: e.message }))
    if (!r) continue
    await store.logTask((await store.task(next.id))!, 'engine', r.state === 'working' ? `started: ${next.after} done` : `could not start after ${next.after}: ${r.waiting ?? ''}`)
    started.push(next.id)
  }
  return started
}

// Tasks a wake or an automation would have started, held for room: each
// starts once a machine the project allows has room, one per machine and tick
// (the next reading counts the new agent). Chained ones are startChained's. A wake's task
// still holds to its autopilot (on, limits, hours, pace), an automation's to
// the pace: over a limit it waits, with why; the autopilot off drops the hold.
export async function startHeld(deps: PmLaunchDeps, now = Date.now()) {
  const { store } = deps
  const projects = await store.projects(), runs = await store.runs(), started: string[] = [], machines = new Set<string>()
  for (const t of (await store.tasks()).filter(x => x.held && x.state === 'todo' && !x.after)) {
    const p = projects.find(x => x.key === t.project)
    if (!p) continue
    const pace = pacedStart(t, 'wake') ? await paceOf(store, p, t, now) : undefined
    const why = originOf(t) === 'automation' ? paceRefusal(pace?.verdict)
      : coordinatorStartRefusal((await store.coordinator(p.key))?.autopilot, t, (await store.tasks()).filter(x => x.project === p.key), runs, now, true, { pace: pace?.verdict, holds: await slotsOf(store, [p]) })
    if (why && /autopilot on/.test(why)) { await store.logTask({ ...t, held: undefined }, 'engine', `no longer held: ${why}`); continue }
    const placed = why ? { hold: `Waits: ${why}` } : await placeFor(deps, t, { waits: pace?.waits })
    if ('hold' in placed) { if (placed.hold !== t.held) await store.saveTask({ ...t, held: placed.hold }); continue }
    if (machines.has(placed.machine)) continue
    machines.add(placed.machine)
    forgetMemory(placed.machine)
    const r = await startTask(deps, t.id, { on: placed.machine }).catch((e: Error) => startedElsewhere(e) ? null : ({ ...t, state: 'waiting' as const, waiting: e.message }))
    if (!r) continue
    await store.logTask((await store.task(t.id))!, 'engine', r.state === 'working' ? 'started: there is room' : `could not start: ${r.waiting ?? ''}`)
    started.push(t.id)
  }
  return started
}

// The worker fixing a failed step action (release.ts fixWatch): its quiet
// time kept; stopped or ended without its report, the step is the user's again.
async function noteFixWork(deps: PmLaunchDeps, task: Task, plan: PlannedStep[], run: Run, now: number): Promise<Task> {
  if (!task.step || !retriesAction(plan, task.step)) return task
  let status: Parameters<typeof fixWatch>[2] = 'gone'
  if (run.terminal && run.state !== 'ended') {
    const st = await deps.call<{ status?: string | { state?: string } }>('terminal.get', { terminal: run.terminal }, 3000).catch(() => null)
    const s = typeof st?.status === 'string' ? st.status : st?.status?.state
    status = !st ? undefined : s === 'idle' || s === 'done' ? 'idle' : 'working'
  }
  const step = fixWatch(plan, task.step, status, now)
  if (!step) return task
  return step.yourTurn ? deps.store.logTask({ ...task, step }, 'engine', step.yourTurn.badge) : deps.store.saveTask({ ...task, step })
}

// The task's worker as this pass sees it; undefined: unknown (unread, still
// starting, stopped by the user).
async function workerNow(deps: PmLaunchDeps, run: Run): Promise<WorkerNow | undefined> {
  if (run.state === 'ended') return run.endedBy === 'stopped' ? undefined : 'gone'
  const m = deps.machines().find(x => x.key === run.machine)
  if (m && !m.local && m.status !== 'online') return 'offline'
  if (!run.terminal) return
  const st = await deps.call<{ state?: string }>('terminal.get', { terminal: run.terminal }, 3000)
    .catch((e: unknown) => (e instanceof CoreError && e.kind === 'not_found' ? { state: 'finished' } : null))
  return !st ? undefined : st.state === 'finished' ? 'gone' : 'alive'
}

// Work the engine handed the worker (handedWatch): its worker ended, started
// again with it; it cannot be, the step says why it waits and the
// coordinator is woken once (none: it is the user's).
async function noteHandedWork(deps: PmLaunchDeps, task: Task, plan: PlannedStep[], run: Run, now: number): Promise<Task> {
  const s = task.step
  if (!s?.agent || task.state !== 'working' || s.done) return task
  const todo = handedWatch(plan, s, await workerNow(deps, run))
  if (!todo) return task
  if ('back' in todo) return deps.store.logTask({ ...task, step: agentWaits(s, undefined) }, 'engine', `${s.agent.kind}: the worker is back on it`)
  if ('waits' in todo) return handedWaits(deps, task, todo.waits, now)
  if (run.state !== 'ended') await deps.store.saveRun({ ...run, state: 'ended', endedBy: 'exit' })
  let hold: string | undefined
  await reviveWorker(deps, task.id, `${s.agent.kind}: its agent ended`, s.agent.text, h => { hold = h })
  const fresh = (await deps.store.task(task.id))!
  if (hold) return handedWaits(deps, fresh, hold, now)
  if (!fresh.step?.agent) return fresh
  // Started (or not: the task waits with why): never started again for this work.
  const step = agentWaits(fresh.step, undefined)
  return deps.store.saveTask({ ...fresh, step: { ...step, agent: { ...step.agent!, revived: now } } })
}

// The handed work waits for `why`: said on the step, the coordinator woken once (none: the user's).
async function handedWaits(deps: PmLaunchDeps, task: Task, why: string, now: number): Promise<Task> {
  const work = task.step!.agent!
  if (work.waits === why) return task
  const told = work.told ?? ((await wakeCoordinators(deps, task, `${task.id} (${task.title}): ${work.kind} was handed to its worker, which cannot do it: ${why}. \`wherdr pm tell ${task.id} "<what to do>" --fix ${work.kind === 'catch-up' ? 'base' : 'ci'} --reason "<why>"\` starts it again with it.`, now)).length ? 'coordinator' : 'user')
  const woke = work.told ? '' : told === 'coordinator' ? ' Woke its coordinator.' : ' In Your turn.'
  return deps.store.logTask({ ...task, step: agentWaits(task.step!, why, told) }, 'engine', `${work.kind}: ${why}.${woke}`)
}

// Kept for the board: since when the agent holding the step sits idle while
// the step waits for its report (pm/blocked.ts), also past its timeout. Unread
// status: unchanged. Idle, then seen working: back to work (backToWork).
async function noteIdle(deps: PmLaunchDeps, task: Task, plan: PlannedStep[], runs: Run[], now: number): Promise<Task> {
  const open = task.step?.yourTurn?.reason === 'timeout' ? { ...task, step: { ...task.step, yourTurn: undefined } } : task
  const step = awaitsHolder(open, plan) ? plan[task.step!.at] : undefined
  const holder = step && runs.filter(r => r.task === task.id && r.role === step.holder && r.state !== 'ended' && r.terminal).sort((a, b) => b.startedAt - a.startedAt)[0]
  let idle: number | undefined
  if (holder) {
    const st = await deps.call<{ status?: string | { state?: string } }>('terminal.get', { terminal: holder.terminal }, 3000).catch(() => null)
    if (!st) return task
    const s = typeof st.status === 'string' ? st.status : st.status?.state
    idle = s === 'idle' || s === 'done' ? task.idle ?? now : undefined
    if (task.idle !== undefined && s === 'working') {
      const saved = await deps.store.saveTask({ ...task, idle })
      return noteBack(deps.store, saved, plan, 'engine', `the ${step!.holder} is working again`, now)
    }
  }
  return idle === task.idle ? task : deps.store.saveTask({ ...task, idle })
}

export async function mechanicTick(deps: PmLaunchDeps, now = Date.now()) {
  const { store } = deps
  if (!(await store.enabled())) return []
  await syncWaits(deps).catch(() => {})
  await advanceTick(deps, now).catch(() => {})
  await releaseIdle(deps, now).catch(() => {})
  await startChained(deps, now).catch(() => {})
  await startHeld(deps, now).catch(() => {})
  const projects = await store.projects(), runs = await store.runs()
  const made: { task: string, move: Move['kind'] }[] = []
  const seen: Seen[] = []
  for (let task of await store.tasks()) {
    if (task.state === 'todo' || task.step?.done) {
      prSeen.delete(task.id)
      if (task.queue) { const { queue: _, ...t } = task; await store.saveTask(t) }
      continue
    }
    const p = projects.find(x => x.key === task.project)
    const t = p ? await store.workflow(p.key) : null
    if (!p || !t) continue
    const run = runs.filter(r => r.task === task.id && r.role === 'worker').sort((a, b) => b.startedAt - a.startedAt)[0]
    if (!run) continue
    const plan = taskPlan(t, task, p)
    // Before the machine is reached: work handed to a worker on a machine gone offline says so.
    task = await noteHandedWork(deps, task, plan, run, now)
    let on: string | undefined
    try { on = runOn(deps, run) } catch { continue }
    const sh = actionShell(deps, on)
    task = await noteIdle(deps, task, plan, runs, now)
    task = await noteFixWork(deps, task, plan, run, now)
    const facts: MechFacts = { task, plan, guards: taskGuards(t, task.type), branch: run.branch, agentBusy: false, now }
    if (task.state === 'waiting' && task.waitKind === 'auth') {
      facts.loggedIn = (await exec(deps, on, `${PATH_SETUP}\n${LOGIN_SCRIPT}`, [run.program]).catch(() => null))?.code === 0
    } else if (task.step && plan.slice(0, task.step.at).some(s => s.action?.kind === 'github.pr')) {
      const r = await sh(SCRIPT.prInfo, [run.worktree, run.branch])
      if (r.code !== 0) continue
      const lines = r.out.split('\n')
      try { facts.pr = (JSON.parse(lines.at(-1) || '[]') as PrInfo[])[0] } catch { continue }
      facts.head = lines[0]?.trim()
      // The worker pushed the work the engine handed it: the step's Your turn, if any, comes back.
      const work = task.step?.agent
      if (work?.head && facts.pr && facts.pr.headRefOid !== work.head) {
        const retry = retriesAction(plan, task.step!)
        facts.task = task = await store.logTask({ ...task, step: agentBack(task.step!) }, 'engine', `${work.kind}: the worker pushed it${retry ? `, ${plan[task.step!.at]!.id} is tried again` : ''}`)
        if (retry) facts.task = task = await stepAction(deps, task.id, 'engine').catch(() => task)
      }
      // Kept for the board: a task is stalled only while its CI is still red (pm/blocked.ts).
      const ci = ciOf(facts.pr, facts.head)
      if (ci && (ci.head !== task.ci?.head || ci.red !== task.ci?.red)) facts.task = task = await store.saveTask({ ...task, ci })
      const seen = prNow(facts.pr, requiredChecks(plan))
      if (seen) prSeen.set(task.id, seen)
      else prSeen.delete(task.id)
      const st = run.terminal ? await deps.call<{ status?: string | { state?: string } }>('terminal.get', { terminal: run.terminal }, 3000).catch(() => null) : null
      const s = typeof st?.status === 'string' ? st.status : st?.status?.state
      facts.agentBusy = s === 'working' || s === 'blocked'
      // Red, neither re-run nor sent back yet: its log says whether the code failed or the infrastructure.
      if (ci?.red && !facts.agentBusy && !task.mech?.[`rerun:${ci.head}`] && !task.mech?.[`red:${ci.head}`])
        facts.infra = infraLog((await sh(SCRIPT.failedLog, [run.worktree, ci.head]).catch(() => null))?.out ?? '')
    }
    // A stall: the coordinator's wake, one nudge, then the user's (pmStall.ts).
    facts.task = task = await noteStall(deps, task, plan, runs, run.worktree, sh, now).catch(() => task)
    seen.push({ facts, run, sh })
  }
  await queueTick(deps, seen)
  for (const { facts, run, sh } of seen) {
    let task = facts.task
    const block = blockOf(task)
    if (block && !fixOf(task, block)) task = await store.saveTask({ ...task, selfFix: noteFix(task, block, now) })
    const next = nextMove({ ...facts, task })
    const fix = block && next && FIX_MOVE[block] === next.move.kind ? block : undefined
    // No move, or past its tries: the coordinator's, once.
    if (!next || (fix && !mayTry(task, fix))) { await escalate(deps, task, now); continue }
    const tried = fix && { selfFix: noteFix(task, fix, now, TRY_TEXT[next.move.kind]) }
    const noted = await store.saveTask({ ...task, mech: { ...task.mech, [next.key]: now }, ...tried })
    const text = await perform(deps, noted, run, next.move, facts, sh).catch((e: Error) => `failed: ${e.message}`)
    // Not delivered (the agent's terminal is gone): tried again on a later tick.
    if (text === null) {
      const { [next.key]: _, ...mech } = (await store.task(task.id))!.mech ?? {}
      await store.saveTask({ ...(await store.task(task.id))!, mech })
      continue
    }
    await store.logTask((await store.task(task.id))!, 'engine', `${next.move.kind}: ${text}`)
    made.push({ task: task.id, move: next.move.kind })
  }
  return made
}

// What a try on a block is, in the coordinator's wake.
const TRY_TEXT: Partial<Record<Move['kind'], string>> = {
  'catch-up': 'an update with the base (a conflict goes to the worker)',
  'sync-push': 'a sync of the branch with its remote, then the push again',
  'retry-action': 'the action again',
}

// The engine gives up on a block: the project's coordinator and the main one
// woken once with what was tried, each whose autopilot wakes it for stuck
// tasks (as its 'stuck' event would have); else the user's (Your turn).
async function escalate(deps: PmLaunchDeps, task: Task, now: number) {
  const why = escalation(task, now)
  if (!why) return
  const woken = await wakeCoordinators(deps, task, why, now)
  await deps.store.logTask({ ...task, selfFix: { ...task.selfFix!, woke: now } }, 'engine', `gave up: ${why}${woken.length ? ` Woke ${woken.join(' and ')}.` : ''}`)
}

// The task's coordinators whose autopilot wakes them for stuck tasks, woken with why; who was woken.
async function wakeCoordinators(deps: PmLaunchDeps, task: Task, why: string, now: number) {
  const { store } = deps
  const coords = new Map([[task.project, await store.coordinator(task.project)], [MAIN, await store.coordinator(MAIN)]])
  const keys = wakesFor([task.project, MAIN], k => coords.get(k) ?? undefined, now)
  for (const key of keys) await store.saveWakes([enqueue(await store.wakes(), key, [why], now, randomUUID().replace(/-/g, '').slice(0, 8))])
  return keys.map(k => (k === MAIN ? 'the main coordinator' : 'the project\'s coordinator'))
}

async function perform(deps: PmLaunchDeps, task: Task, run: Run, move: Move, f: MechFacts, sh: ReturnType<typeof actionShell>): Promise<string | null> {
  // A worker that ended (released, or on its own) starts again with it; no
  // room on its machine: handed all the same, waiting with why (null: not delivered, tried again later).
  const tell = async (text: string): Promise<string | { hold: string } | null> => {
    const now = await workerNow(deps, run)
    if (now === 'alive') return deps.call('terminal.send', { terminal: run.terminal, text }, 30000).then(() => 'sent to the agent', () => null)
    if (now !== 'gone') return now === 'offline' ? { hold: MACHINE_OFFLINE } : null
    if (run.state !== 'ended') await deps.store.saveRun({ ...run, state: 'ended', endedBy: 'exit' })
    let hold: string | undefined
    const t = await reviveWorker(deps, task.id, move.kind, text, h => { hold = h })
    return hold ? { hold } : t ? (t.state === 'working' ? 'started the worker again with it' : 'could not start the worker again') : null
  }
  // Work handed to the worker: the task leaves Your turn, its agents stay, until a push or its report.
  const hand = async (text: string) => {
    const r = await tell(text)
    if (!r || (typeof r === 'string' && r.startsWith('could not'))) return r
    const t = (await deps.store.task(task.id))!
    if (!t.step) return typeof r === 'string' ? r : r.hold
    const step = handToAgent(t.step, move.kind, f.pr?.headRefOid ?? f.head!, Date.now(), text)
    const revived = r === 'started the worker again with it' ? { ...step, agent: { ...step.agent!, revived: Date.now() } } : step
    const saved = await deps.store.saveTask({ ...t, step: revived })
    if (typeof r === 'string') return r
    await handedWaits(deps, saved, r.hold, Date.now())
    return `handed to the worker, which waits: ${r.hold}`
  }
  switch (move.kind) {
    case 'restart':
      // The agent stopped on its login may still sit in its terminal: one agent per task.
      if (run.terminal && run.state !== 'ended') await deps.call('terminal.kill', { terminal: run.terminal }, 15000).catch(() => {})
      await deps.store.saveRun({ ...run, state: 'ended', endedBy: 'exit' })
      await deps.store.saveTask({ ...task, waitKind: undefined })
      return `the login is back; ${(await startTask(deps, task.id)).state}`
    case 'retry-action': case 'merge':
      return `step ${(await stepAction(deps, task.id, 'engine')).step?.yourTurn?.badge ?? 'went on'}`
    case 'sync-push': {
      // The remote's commits in the worktree, then the push again; a conflict is the worker's.
      const r = await sh(SCRIPT.sync, [run.worktree, run.branch])
      if (r.code === CODE.SEND_BACK) return hand(`${lastLine(r.out)}. Merge origin/${run.branch} into your branch, resolve the conflicts, commit, then say you are done.`)
      if (r.code !== 0) return lastLine(r.out)
      return `${lastLine(r.out)}; step ${(await stepAction(deps, task.id, 'engine')).step?.yourTurn?.badge ?? 'went on'}`
    }
    case 'fix-base': {
      const refused = guardAction(f.guards, { kind: 'github.pr', base: move.base }, { branch: run.branch, by: 'engine' })
      if (refused) return refused
      const r = await sh(SCRIPT.pr, [run.worktree, run.branch, move.base, `${task.id}: ${task.title}`], task.description || task.title)
      return r.code === 0 ? `PR base set to ${move.base}` : lastLine(r.out)
    }
    case 'catch-up': {
      // A merge step waiting for the user: the card says it is updating, until the PR is clean.
      const waiting = waitsToMerge(f.plan[task.step!.at])
      const from = task.step!.catchUp?.from ?? f.head!
      if (waiting && !task.step!.catchUp) await stepEvent(deps, task.id, f.plan, { kind: 'catch-up', base: move.base, head: f.head! })
      const r = await sh(SCRIPT.catchUp, [run.worktree, move.base, run.branch])
      if (r.code === CODE.SEND_BACK) {
        return hand(waiting
          ? `${lastLine(r.out)}. Merge origin/${move.base} into your branch, resolve the conflicts, commit, then stop: the engine pushes it.`
          : `${lastLine(r.out)}. Merge origin/${move.base} into your branch, fix it, commit, then say you are done.`)
      }
      if (waiting) {
        const head = r.code === 0 ? lastLine(r.out) : undefined
        const since = reviewedCommit(f.plan, task.step!) ?? from
        await stepEvent(deps, task.id, f.plan, head
          ? { kind: 'caught-up', head, ...(f.head !== from ? { review: { since, head } } : {}) }
          : { kind: 'caught-up', error: `update with ${move.base}: ${lastLine(r.out)}` })
      }
      if (r.code === 0) return `caught up with ${move.base}`
      return catchUpGaveUp(task, f.head) ? `${lastLine(r.out)} (failed ${CATCH_UP_TRIES} times: it leaves the front of the merge queue)` : lastLine(r.out)
    }
    case 'rerun-ci': {
      const r = await sh(SCRIPT.rerun, [run.worktree, f.head!])
      return r.code === 0 ? `ran ${move.checks.join(', ')} again` : lastLine(r.out)
    }
    case 'ci-to-agent': return hand(redCiText(move.checks, f.head!))
  }
}

interface Seen { facts: MechFacts, run: Run, sh: ReturnType<typeof actionShell> }

// Each project's merge queue (shared/pm/mergeQueue.ts): every task's place
// kept on it and logged as it enters or reaches the front; the first one is
// checked against its base, as GitHub flags a branch behind only when it must be up to date.
async function queueTick(deps: PmLaunchDeps, seen: Seen[]) {
  const queued = seen.filter(x => inMergeQueue(x.facts.task, x.facts.plan, x.facts.guards, x.facts.pr))
  for (const project of new Set(seen.map(x => x.facts.task.project))) {
    const mine = queued.filter(x => x.facts.task.project === project)
    const order = mergeOrder(mine.map(({ facts: { task, pr, head } }) => ({
      id: task.id, files: (pr!.files ?? []).map(f => f.path), size: (pr!.additions ?? 0) + (pr!.deletions ?? 0),
      first: task.queue === 1 || !!task.step!.catchUp || !!task.step!.agent, red: !!task.ci?.red || catchUpGaveUp(task, head),
    })))
    for (const x of mine) {
      const place = order.indexOf(x.facts.task.id) + 1
      x.facts.queue = place
      if (x.facts.task.queue === place) continue
      const t = { ...x.facts.task, queue: place }
      const said = place === 1 ? 'first in the merge queue: it is updated with its base, then merges once its checks pass'
        : x.facts.task.queue ? undefined : `${ordinal(place)} in the merge queue`
      x.facts.task = await (said ? deps.store.logTask(t, 'engine', said) : deps.store.saveTask(t))
    }
    const first = mine.find(x => x.facts.queue === 1)
    const pr = first?.facts.pr
    if (first && pr && !first.facts.agentBusy && !['BEHIND', 'DIRTY'].includes(pr.mergeStateStatus ?? '')) {
      const r = await first.sh(SCRIPT.behind, [first.run.worktree, pr.baseRefName]).catch(() => null)
      first.facts.behind = r?.code === 0 && lastLine(r.out) === 'behind'
    }
  }
  // Out of the queue (merged, stopped, waiting for the user): its place goes.
  for (const x of seen.filter(y => y.facts.task.queue && !queued.includes(y))) {
    const { queue: _, ...t } = x.facts.task
    x.facts.task = await deps.store.saveTask(t)
  }
}

// A step event the mechanic gives a task, on its fresh state; its log lines go to the task's log.
async function stepEvent(deps: PmLaunchDeps, id: string, plan: PlannedStep[], ev: StepEvent) {
  const task = (await deps.store.task(id))!
  const r = onEvent(plan, task.step!, ev, Date.now())
  if (r.refused) return
  const log = r.effects.flatMap(e => (e.kind === 'log' ? [e.text] : [])).join('; ')
  await (log ? deps.store.logTask({ ...task, step: r.state }, 'engine', log) : deps.store.saveTask({ ...task, step: r.state }))
}
