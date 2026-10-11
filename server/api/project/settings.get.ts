// Settings of a coordinator's project (`?pane=<id>`): PROJECT.md's front
// matter, read-only. Safety settings are not part of it.
import { readProjectSettings } from '../../utils/projectDocs'

export default defineApi(async (event) => {
  const p = findPane(String(getQuery(event).pane || ''))
  if (!p) throw new HerdrError('bad_pane', 'Pane not found')
  return readProjectSettings(p)
})
