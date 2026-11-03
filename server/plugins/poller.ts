// Background tasks: Herdr polling (session.snapshot every second), VAPID
// keys, notifications from `herdr notification show`, the phone address
// `tailscale serve` publishes (server/utils/phone.ts), purge of photos and attached files older than 7 days, and of the pasted texts kept for 30 days.
export default defineNitroPlugin((nitroApp) => {
  if (process.env.WHERDR_BACKEND === 'core') {
    initVapid()
    startPolling()
    // Housekeeping that still applies: the phone address, photos and pasted texts.
    startTailnetWatch()
    cleanUploads()
    cleanAttachments()
    purgePastes()
    const purge = setInterval(() => { cleanUploads(); cleanAttachments(); purgePastes() }, 6 * 3600 * 1000)
    nitroApp.hooks.hook('close', () => { stopPolling(); stopTailnetWatch(); clearInterval(purge) })
    return
  }
  initVapid()
  startMachines()
  startPolling()
  startNotices()
  startPaneSizes()
  onTailnetName(adoptTailnetName)
  startTailnetWatch()
  cleanUploads()
  cleanAttachments()
  purgePastes()
  const purge = setInterval(() => { cleanUploads(); cleanAttachments(); purgePastes() }, 6 * 3600 * 1000)
  log(`herdr-web — socket ${HERDR_SOCK}${HERDR_SESSION ? ` (session ${HERDR_SESSION})` : ''}`)
  nitroApp.hooks.hook('close', () => {
    stopPolling()
    stopNotices()
    stopPaneSizes()
    stopTailnetWatch()
    stopMachines()
    clearInterval(purge)
  })
})
