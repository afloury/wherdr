// What Start offers on a task: `?machine=<key>&id=<repo>/<n>` → its default
// agent (`show <id> --json`, worker.agent) and the agents installed on its machine.
import { taskStartOptions } from '../../utils/projectsTasks'

export default defineApi(async (event) => {
  const q = getQuery(event)
  return taskStartOptions(q.machine ?? '', q.id)
})
