// A finished task's conversation, as the board recorded it:
// `?machine=<key>&id=<repo>/<n>&role=worker|reviewer`, with /api/chat's
// `since`, `from` and `before`. Read only (server/utils/projectsTasks.ts taskTranscript).
import { taskTranscript } from '../../utils/projectsTasks'

export default defineApi(async (event) => {
  const q = getQuery(event)
  const num = (k: string) => (q[k] !== undefined ? Math.max(0, Number(q[k]) || 0) : null)
  const r = await taskTranscript(q.machine ?? '', q.id, q.role, { since: String(q.since || ''), from: num('from'), before: num('before') })
  if (r.items) {
    r.items = chatPasted(r.items)
    await addUploadHashes(r.items)
  }
  return r
})
