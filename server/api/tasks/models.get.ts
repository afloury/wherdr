// The models and effort levels Start offers for a program on a task's machine:
// `?machine=<key>&program=<kind>[&refresh=1]` (`herdr-projects models <program>`).
import { taskStartModels } from '../../utils/projectsTasks'

export default defineApi(async (event) => {
  const q = getQuery(event)
  return taskStartModels(q.machine ?? '', q.program, q.refresh === '1')
})
