// Mode silence : aucune notification push tant qu'il est actif, pour un
// appareil (son abonnement) ou pour tous. `until` : fin en ms (epoch), ou null
// pour « jusqu'à réactivation ». Un silence expiré ne compte plus : le retour à
// la normale est automatique, sans tâche planifiée.
export interface Quiet { until: number | null }
export type QuietScope = 'device' | 'all'
export type QuietDuration = 'hour' | 'morning' | 'manual'

// Borne des durées acceptées (un silence plus long = « jusqu'à réactivation »).
export const QUIET_MAX_MS = 7 * 24 * 3600 * 1000

export function quietActive(q: Quiet | null | undefined, now = Date.now()): boolean {
  return Boolean(q) && (q!.until === null || now < q!.until)
}

export function silenced(global: Quiet | null | undefined, device: Quiet | null | undefined, now = Date.now()): boolean {
  return quietActive(global, now) || quietActive(device, now)
}

// Prochain 8 h (heure locale) strictement après `now` : demain matin, ou ce
// matin si l'on coupe au milieu de la nuit.
export function nextMorning(now: Date, hour = 8): number {
  const d = new Date(now)
  d.setHours(hour, 0, 0, 0)
  if (d.getTime() <= now.getTime()) d.setDate(d.getDate() + 1)
  return d.getTime()
}

export function quietUntil(duration: QuietDuration, now = new Date()): number | null {
  if (duration === 'hour') return now.getTime() + 3600 * 1000
  if (duration === 'morning') return nextMorning(now)
  return null
}

// Corps de requête -> silence valide, `null` pour l'arrêt, `undefined` si refusé.
export function parseQuiet(on: unknown, until: unknown, now = Date.now()): Quiet | null | undefined {
  if (on === false) return null
  if (on !== true) return undefined
  if (until === null || until === undefined) return { until: null }
  if (typeof until !== 'number' || !Number.isFinite(until) || until <= now || until > now + QUIET_MAX_MS) return undefined
  return { until: Math.round(until) }
}
