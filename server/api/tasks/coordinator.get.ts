// The pane a coordinator talks in: `?machine=<key>&kind=main|machine|project&repo=<name>`
// (`herdr-projects coordinator [--machine | --project=REPO] status --json`).
import { coordinatorPane } from '../../utils/projectsTasks'

export default defineApi(async (event) => {
  const q = getQuery(event)
  return coordinatorPane(q.machine ?? '', { kind: q.kind, repo: q.repo })
})
