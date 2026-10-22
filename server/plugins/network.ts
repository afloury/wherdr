// Startup check of the listening address (server/utils/network.ts,
// listenVerdict): wherdr refuses to listen on an open network unless
// WHERDR_TRUSTED_NETWORKS says so, and warns loudly when it accepts any network.
// Runs before the server listens (Nitro plugins load first).
import { listenVerdict, startNetworkWatch, stopNetworkWatch, trustedNetworks } from '../utils/network'

export default defineNitroPlugin((nitroApp) => {
  // Read Tailscale's peers and Funnel now, then periodically.
  void startNetworkWatch()
  nitroApp.hooks.hook('close', stopNetworkWatch)
  if (import.meta.dev) return
  const trusted = trustedNetworks()
  if (trusted.invalid.length) log(`WARNING: WHERDR_TRUSTED_NETWORKS: ignored ${trusted.invalid.join(', ')} (not an address or a CIDR range)`)
  const host = process.env.NITRO_HOST || process.env.HOST || ''
  const verdict = listenVerdict(host, trusted)
  if (!verdict.ok) {
    console.error(`\n${verdict.message}\n`)
    process.exit(1)
  }
  if (verdict.warn) log(`WARNING: ${verdict.warn}`)
})
