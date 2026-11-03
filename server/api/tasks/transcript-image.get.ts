// An image of a finished task's conversation (transcript.get.ts), re-read from its file.
import { taskTranscriptImage } from '../../utils/projectsTasks'

export default defineEventHandler(async (event) => {
  const q = getQuery(event)
  try {
    const img = await taskTranscriptImage(q.machine ?? '', q.id, q.role, String(q.file || ''), String(q.ref || ''), Number(q.i) || 0)
    if (!img) return sendError(event, 404, { error: 'Image not found' })
    return sendImage(event, img)
  } catch {
    return sendError(event, 404, { error: 'Image not found' })
  }
})
