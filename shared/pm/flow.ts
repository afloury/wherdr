// What the interface draws of a workflow and an autopilot: the steps of a task
// in a row (who holds each), and when the autopilot wakes next.
import { durationMs, planSteps } from './steps'
import { nextRun, parseSchedule } from './schedule'
import type { Autopilot } from './autopilot'
import type { Holder, Template } from './workflow'

export interface FlowStep { id: string, holder: Holder }

// The steps of its first task type (or the one named), shared steps resolved.
export function workflowFlow(t: Template | null | undefined, type?: string): FlowStep[] {
  const name = type ?? Object.keys(t?.taskTypes ?? {})[0]
  return t && name ? planSteps(t, { type: name }).map(s => ({ id: s.id, holder: s.holder ?? 'none' })) : []
}

// A proposed change drawn: the steps of one task type (the first changed, else
// the first one) before and after it.
export interface ProposalFlow { type: string, before: FlowStep[], after: FlowStep[] }
export function proposalFlow(old: Template | null, next: Template, type?: string): ProposalFlow | undefined {
  const name = type ?? Object.keys(next.taskTypes)[0]
  return name ? { type: name, before: workflowFlow(old, name), after: workflowFlow(next, name) } : undefined
}

// The next scheduled wake: its interval after the last one, or its next fixed
// time, whichever comes first. Off or with neither: none.
export function nextWakeAt(ap: Autopilot | undefined, ranAt: number | undefined, atRan: number | undefined, now: number): number | undefined {
  if (!ap?.on) return undefined
  const times: number[] = []
  if (ap.every) times.push(Math.max(now, (ranAt ?? 0) + durationMs(ap.every)))
  const at = ap.at ? parseSchedule(ap.at) : null
  const slot = at && !('error' in at) ? nextRun(at, atRan ?? now) : null
  if (slot !== null) times.push(Math.max(now, slot))
  return times.length ? Math.min(...times) : undefined
}
