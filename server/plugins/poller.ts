// Tâches de fond : sondage de Herdr (session.snapshot chaque seconde), clés
// VAPID, notifications de `herdr notification show`, purge des photos de plus de 7 jours.
export default defineNitroPlugin((nitroApp) => {
  initVapid()
  startMachines()
  startPolling()
  startNotices()
  cleanUploads()
  const purge = setInterval(cleanUploads, 6 * 3600 * 1000)
  log(`herdr-web — socket ${HERDR_SOCK}${HERDR_SESSION ? ` (session ${HERDR_SESSION})` : ''}`)
  nitroApp.hooks.hook('close', () => {
    stopPolling()
    stopNotices()
    stopMachines()
    clearInterval(purge)
  })
})
