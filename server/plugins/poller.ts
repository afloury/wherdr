// Background tasks: Herdr polling (session.snapshot every second), VAPID
// keys, notifications from `herdr notification show`, purge of photos and attached files older than 7 days.
export default defineNitroPlugin((nitroApp) => {
  initVapid()
  startMachines()
  startPolling()
  startNotices()
  cleanUploads()
  cleanAttachments()
  const purge = setInterval(() => { cleanUploads(); cleanAttachments() }, 6 * 3600 * 1000)
  log(`herdr-web — socket ${HERDR_SOCK}${HERDR_SESSION ? ` (session ${HERDR_SESSION})` : ''}`)
  nitroApp.hooks.hook('close', () => {
    stopPolling()
    stopNotices()
    stopMachines()
    clearInterval(purge)
  })
})
