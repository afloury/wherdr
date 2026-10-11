// An action on a thread of a coordinator's project: `{ pane_id, id, action }`,
// action = stop | restart | ack | resolve, run as `herdr-projects thread
// <action> <slug> <id>` on the coordinator's machine.
import { withoutContainerTicker } from '../../utils/plugins'
import { runThreadAction } from '../../utils/projectThreads'

export default defineApi(async (_event, body) => {
  const p = findPane(String(body.pane_id || ''))
  if (!p) throw new HerdrError('bad_pane', 'Pane not found')
  // `thread restart` starts the ticker when none runs: never left in the container.
  return runThreadAction(p, body.id, body.action, (t, run) => withoutContainerTicker(t.m, run))
})
