// Route d'API inconnue (ou mauvaise méthode) : 404 au format de l'ancien serveur.
export default defineEventHandler(event => sendError(event, 404, { error: 'introuvable' }))
