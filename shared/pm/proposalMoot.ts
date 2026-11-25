import { MAIN, coordinatorBy } from './coordinator'
import { workflowChanges } from './workflowChanges'
import type { Template } from './workflow'

// A pending proposal that is moot: where it was dealt with, or undefined while it still waits.
// answers: the project's answers kept; log: its workflow's log (the change saved since is another's).
export function proposalMoot(
  p: { at: number, by?: string, template: Template },
  current: Template | null,
  log: readonly { at: number, by: string }[],
  answers: readonly { outcome: string, proposedAt?: number }[],
  project: string,
): string | undefined {
  const done = answers.find(a => a.proposedAt === p.at && (a.outcome === 'accepted' || a.outcome === 'refused'))
  if (done) return done.outcome === 'accepted' ? 'applied elsewhere' : 'cancelled elsewhere'
  const c = workflowChanges(current, p.template)
  if (!c.all.length && !c.types.length) return 'already applied'
  const proposer = p.by === 'main' ? MAIN : project
  const saved = log.findLast(x => x.at > p.at && x.by !== coordinatorBy(proposer) && (x.by === coordinatorBy(MAIN) || x.by.startsWith('coordinator ')))
  if (!saved) return
  return saved.by === coordinatorBy(MAIN) ? 'applied through Alfred' : 'applied through the project\'s coordinator'
}
