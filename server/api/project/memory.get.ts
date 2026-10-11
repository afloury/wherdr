// Memory of a coordinator's project (`?pane=<id>`): its files, or with
// `&name=<file.md>` the text of one. Read-only.
import { readMemoryFile, readProjectMemory } from '../../utils/projectDocs'

export default defineApi(async (event) => {
  const q = getQuery(event)
  const p = findPane(String(q.pane || ''))
  if (!p) throw new HerdrError('bad_pane', 'Pane not found')
  return q.name === undefined ? readProjectMemory(p) : readMemoryFile(p, q.name)
})
