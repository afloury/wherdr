// Image of a conversation message, re-read from the transcript.
export default defineEventHandler(async (event) => {
  const q = getQuery(event)
  try {
    const p = findPane(String(q.pane || ''))
    const img = p ? await transcripts.image(p, String(q.file || ''), String(q.ref || ''), Number(q.i) || 0) : null
    if (!img) return sendError(event, 404, { error: 'Image not found' })
    return sendImage(event, img)
  } catch {
    return sendError(event, 404, { error: 'Image not found' })
  }
})
