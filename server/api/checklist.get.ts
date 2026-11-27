// The ticks on the task lists of a conversation's agent messages.
import { readChecklist } from '../utils/checklistStore'

export default defineApi(async event => ({ state: await readChecklist(String(getQuery(event).pane_id || '')) }))
