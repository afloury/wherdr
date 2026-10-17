// Moves a task in the coordinator's TASKS.md: `{ pane_id, list, index, text,
// hash, move }`, move = up | down | todo | queue. Refused if the file changed
// since the app read it (hash).
import { moveProjectTask } from '../../utils/taskWrite'

export default defineApi(async (_event, body) => {
  const p = findPane(String(body.pane_id || ''))
  if (!p) throw new HerdrError('bad_pane', 'Pane not found')
  return moveProjectTask(p, body)
})
