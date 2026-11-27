// { pane_id, op: 'toggle', key, at, items, index, checked } or { pane_id, op: 'sent', marks }.
import { updateChecklist } from '../utils/checklistStore'

export default defineApi(async (_event, body) => ({ state: await updateChecklist(String(body.pane_id || ''), body) }))
