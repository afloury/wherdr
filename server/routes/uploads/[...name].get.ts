// Photos sent from the phone (store ~/.cache/herdr-web/uploads).
export default defineEventHandler(async (event) => {
  try {
    const name = decodeURIComponent(getRouterParam(event, 'name') || '')
    const img = await readUpload(name)
    if (!img) return sendError(event, 404, { error: 'Image not found' })
    return sendImage(event, img)
  } catch {
    return sendError(event, 404, { error: 'Image not found' })
  }
})
