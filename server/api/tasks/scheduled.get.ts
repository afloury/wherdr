import { coordinatorScheduled } from '../../utils/projectsTasks'

export default defineApi(async event => {
  const q = getQuery(event)
  return coordinatorScheduled(q.machine ?? '', { kind: q.kind, repo: q.repo })
})
