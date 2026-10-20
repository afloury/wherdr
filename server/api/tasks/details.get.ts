// One herdr-projects task: `?machine=<key>&id=<repo>/<n>` (`details --json`).
import { taskDetails } from '../../utils/projectsTasks'

export default defineApi(async (event) => {
  const q = getQuery(event)
  return taskDetails(q.machine ?? '', q.id)
})
