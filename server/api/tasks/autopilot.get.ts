import { autopilotStatuses, coordinatorAutopilot } from '../../utils/projectsTasks'

// ?machine=X: every coordinator of that machine, by autopilot id.
// ?machine=X&kind=main|machine|project[&repo=R]: one coordinator, with its saved goal and defaults.
export default defineApi(async (event) => {
  const q = getQuery(event)
  if (q.kind === undefined) return autopilotStatuses(q.machine ?? '')
  return coordinatorAutopilot(q.machine ?? '', { kind: q.kind, repo: q.repo })
})
