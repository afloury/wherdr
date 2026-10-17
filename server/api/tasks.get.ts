// herdr-projects 1.x tasks of every machine (the Board). `since=<version>`:
// replies `{ same: true }` when nothing changed. See server/utils/projectsTasks.ts.
import { readTasksBoard } from '../utils/projectsTasks'

export default defineApi(async (event) => {
  const since = getQuery(event).since
  return readTasksBoard(typeof since === 'string' ? since.slice(0, 64) : undefined)
})
