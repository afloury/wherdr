// Unhandled inbox items of a coordinator's project (`?pane=<id>`), read-only.
import { readInbox } from '../../utils/projectInbox'

export default defineApi(async (event) => {
  const p = findPane(String(getQuery(event).pane || ''))
  if (!p) throw new HerdrError('bad_pane', 'Pane not found')
  return readInbox(p)
})
