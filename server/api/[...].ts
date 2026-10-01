// Unknown API route (or wrong method): 404 in the old server's format.
export default defineEventHandler(event => sendError(event, 404, { error: 'introuvable' }))
