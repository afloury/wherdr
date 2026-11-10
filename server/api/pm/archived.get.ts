// ?projects=A,B&q=&offset=: archived tasks, newest first, a page at a time (archive.ts).
import { archivedCards } from '../../utils/pmBoard'
import { pmStore } from '../../utils/pmStore'
import { coreAdminDeps } from '../../utils/coreAdminDeps'

export default defineApi((event) => {
  const q = getQuery(event)
  const projects = String(q.projects ?? '').split(',').filter(Boolean)
  return archivedCards(pmStore(), coreAdminDeps().machines(), { projects, search: String(q.q ?? '').slice(0, 200), offset: Number(q.offset) || 0 })
})
