import { quietActive } from '../../../shared/quiet'
import { replaceSubscription, validPushSubscription } from '../../utils/pushConfig'
export default defineApi(async (event, b) => {
  if (!pushReady()) throw new HerdrError('push_off', 'Web Push non configuré')
  if (!validPushSubscription(b)) throw new HerdrError('bad_sub', 'abonnement invalide')
  const all = await readSubs()
  const sessions: Record<string, string> = {}
  if (b.sessions && typeof b.sessions === 'object' && !Array.isArray(b.sessions)) {
    for (const [key, name] of Object.entries(b.sessions)) {
      if ((key === '' || /^[0-9a-f]{4,32}$/.test(key)) && typeof name === 'string' && /^[\w.-]{1,64}$/.test(name)) sessions[key] = name
    }
  }
  // Réabonnement (langue, portée…) ou nouvel endpoint après réactivation
  // (`previous`) : l'ancienne entrée disparaît, le silence de l'appareil reste.
  const subs = replaceSubscription(all, { endpoint: b.endpoint, keys: { p256dh: b.keys.p256dh, auth: b.keys.auth }, lang: b.lang === 'en' ? 'en' : 'fr',
    notifyScope: b.notifyScope === 'all' ? 'all' : 'project_leads', sessions, addedAt: new Date().toISOString() }, b.previous, quietActive)
  await writeSubs(subs)
  log(`push : abonnement enregistré (${subs.length} appareil(s))`)
  return { ok: true, devices: subs.length }
})
