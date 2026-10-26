// A folder picked for a project coordinator: `?machine=<key>&folder=<path>`.
// `{ state: 'known', repo, root }` (on the board), `{ state: 'new', root }` (added
// when the conversation opens), `{ state: 'missing' }` or `{ state: 'notgit' }`.
import { projectFolder } from '../../utils/projectsTasks'

export default defineApi(async (event) => {
  const q = getQuery(event)
  return projectFolder(q.machine ?? '', q.folder)
})
