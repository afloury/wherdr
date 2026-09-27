// Photos envoyées depuis le téléphone (dépôt ~/.cache/herdr-web/uploads).
export default defineEventHandler(async (event) => {
  try {
    const name = decodeURIComponent(getRouterParam(event, 'name') || '')
    const img = await readUpload(name)
    if (!img) return sendError(event, 404, { error: 'image introuvable' })
    return sendImage(event, img)
  } catch {
    return sendError(event, 404, { error: 'image introuvable' })
  }
})
