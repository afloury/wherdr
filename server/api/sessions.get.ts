import { listSessions } from '../utils/machines'

export default defineApi(async (event) => {
  const key = String(getQuery(event).machine || '')
  return { sessions: await listSessions(key) }
})
