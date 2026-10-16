// Which Herdr agent integrations are installed on each machine (see
// shared/integrations.ts), read with `herdr integration status` only when a
// conversation is not found, and cached: it changes when the user installs one.
import { type IntegrationStatus, parseIntegrationStatus } from '../../shared/integrations'
import { type Machine, runHerdrCli } from './machines'

// WHERDR_INTEGRATION_TTL_MS: shorter in the end-to-end tests.
const ttl = Number(process.env.WHERDR_INTEGRATION_TTL_MS)
const TTL_MS = Number.isFinite(ttl) && ttl >= 0 ? ttl : 60000
const cache = new Map<string, { at: number, status: IntegrationStatus | null, pending?: Promise<IntegrationStatus | null> }>()

// Same home for all the sessions of a machine: one entry per home.
const keyOf = (m: Machine) => (m.local ? '' : `${m.target || m.key}`)

export async function integrationStatus(m: Machine): Promise<IntegrationStatus | null> {
  const key = keyOf(m)
  const hit = cache.get(key)
  if (hit?.pending) return hit.pending
  if (hit && Date.now() - hit.at < TTL_MS) return hit.status
  const pending = runHerdrCli(m, ['integration', 'status'], 8000)
    .then(r => (r.code === 0 ? parseIntegrationStatus(r.stdout.toString('utf8')) : null))
    .catch(() => null)
    // Unknown (old Herdr without the command, SSH failure): nothing is claimed.
    .then((status) => {
      cache.set(key, { at: Date.now(), status: status && Object.keys(status).length ? status : null })
      return cache.get(key)!.status
    })
  cache.set(key, { at: hit?.at || 0, status: hit?.status || null, pending })
  return pending
}
