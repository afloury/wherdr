// Marks one inbox item of a coordinator's project as handled: `{ pane_id, id }`,
// run as `herdr-projects inbox done <slug> <id>` on the coordinator's machine.
import { markInboxDone } from '../../utils/projectInbox'

export default defineApi(async (_event, body) => {
  const p = findPane(String(body.pane_id || ''))
  if (!p) throw new HerdrError('bad_pane', 'Pane not found')
  return markInboxDone(p, body.id)
})
