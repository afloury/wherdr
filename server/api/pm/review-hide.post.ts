// { id, until? | dismiss? | show? }: the user snoozes (`until`, a time) or dismisses an item of
// Tasks to review, or shows it again. Only the entry changes, never the task.
import { reviewHide } from '../../utils/pmBoard'
import { pmStore } from '../../utils/pmStore'

export default defineApi(async (_event, body) => { await reviewHide(pmStore(), body); return { ok: true } })
