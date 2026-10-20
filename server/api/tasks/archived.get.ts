// A machine's archived herdr-projects tasks: `?machine=<key>` (`list --json --archived`).
import { archivedTasks } from '../../utils/projectsTasks'

export default defineApi(async (event) => {
  const q = getQuery(event)
  return archivedTasks(q.machine ?? '')
})
