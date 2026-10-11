// Routines of a coordinator's project (`?pane=<id>`), from `herdr-projects
// routine list`. Read-only: nothing here approves, toggles or runs a routine.
import { readRoutines } from '../../utils/projectInbox'

export default defineApi(async (event) => {
  const p = findPane(String(getQuery(event).pane || ''))
  if (!p) throw new HerdrError('bad_pane', 'Pane not found')
  return readRoutines(p)
})
