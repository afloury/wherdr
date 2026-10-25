import { taskSettings } from '../../utils/projectsTasks'

export default defineApi(async (event) => {
  const q = getQuery(event)
  return taskSettings(q.machine ?? '', q.id)
})
