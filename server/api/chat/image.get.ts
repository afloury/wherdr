// Image d'un message de la conversation, relue dans la transcription.
export default defineEventHandler(async (event) => {
  const q = getQuery(event)
  try {
    const p = findPane(String(q.pane || ''))
    const img = p ? await transcripts.image(p, String(q.file || ''), String(q.ref || ''), Number(q.i) || 0) : null
    if (!img) return sendError(event, 404, { error: 'image introuvable' })
    return sendImage(event, img)
  } catch {
    return sendError(event, 404, { error: 'image introuvable' })
  }
})
