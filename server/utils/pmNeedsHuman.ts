// A worker's `needs-human: <kind> <url>` report carried out (rules in
// shared/pm/needsHuman.ts): saved on the task, and a push straight to the user
// with a link to the task, sent again at 5 and 15 minutes while it is not cleared.
import { NEEDS_HUMAN_CMD, needsHumanDue, needsHumanOpen, parseNeedsHuman, type NeedsHuman } from '../../shared/pm/needsHuman'
import type { Run, Task } from '../../shared/pm/run'
import { shownTaskId } from '../../shared/pm/projectKey'
import type { PmLaunchDeps } from './pmLaunch'
import type { PmStore } from './pmStore'
import { notificationAllowed } from './notificationRules'
import { pushSend } from './push'

export async function needsHumanReport(deps: PmLaunchDeps, run: Run, label: string, now: number) {
  const { store } = deps
  const task = await store.task(run.task)
  if (!task || task.step?.done) return
  const said = parseNeedsHuman(label)
  if (!said) return void await deps.call('terminal.send', { terminal: run.terminal, text: `Not understood. Say it as: ${NEEDS_HUMAN_CMD}` }, 30000)
  if (said === 'clear') {
    if (task.needsHuman) await store.logTask({ ...task, needsHuman: undefined }, 'engine', `needs a person: over (${task.needsHuman.kind})`)
    return
  }
  // The same ask said again keeps its clock: no second first push.
  if (task.needsHuman?.kind === said.kind && task.needsHuman.url === said.url) return
  await store.logTask({ ...task, needsHuman: { ...said, at: now, pushed: 0, step: task.step!.at } }, 'engine', `needs a person: ${said.kind}${said.url ? ` ${said.url}` : ''}`)
  await needsHumanTick(store, now)
}

type Notify = (task: Task, n: NeedsHuman, shown: string, again: boolean) => Promise<number>

const pushNotify: Notify = async (task, n, shown, again) =>
  await notificationAllowed('needs-you', { workspaces: [] }, undefined, { machine: task.machine ?? '', project: task.project, board: true })
    ? pushSend({
      title: `${shown} needs you now${again ? ' (again)' : ''}`, body: `${task.title}: ${n.kind}${n.url ? ` ${n.url}` : ''}`.slice(0, 200),
      tag: `pm-needs-human-${task.id}`, url: `/#/board?task=${encodeURIComponent(task.id)}`,
    })
    : 0

// The pushes due: noted on the task before sending, so a failure never repeats one.
// One that is done, stopped or archived, or whose step moved on, is over.
export async function needsHumanTick(store: PmStore, now = Date.now(), notify: Notify = pushNotify) {
  const projects = await store.projects()
  for (const task of await store.tasks()) {
    const n = task.needsHuman
    if (!n) continue
    if (task.step?.done || task.stopped || task.archived || !needsHumanOpen(task)) { await store.logTask({ ...task, needsHuman: undefined }, 'engine', `needs a person: over (${n.kind})`); continue }
    if (!needsHumanDue(n, now)) continue
    await store.saveTask({ ...task, needsHuman: { ...n, pushed: n.pushed + 1 } })
    await notify(task, n, shownTaskId(projects, task.id), n.pushed > 0).catch(() => 0)
  }
}
