// File attached to a message (PDF, text, code, notebook), for the agent of
// `pane`: stored on its machine, the reference to write in the message is
// returned. `name`: the original file name (kept, made safe).
import { ATTACH_MAX } from '../../shared/attachments'

export default defineApi((event, b) => {
  const q = getQuery(event)
  const pane = String(q.pane || '')
  if (!PANE_RE.test(pane)) throw new HerdrError('bad_pane', 'Invalid pane')
  return saveAttachment(b.data, String(q.name || '').slice(0, 255), pane)
}, { raw: /^application\/octet-stream$/, max: ATTACH_MAX, tooLarge: 'File too large (30 MB max)' })
