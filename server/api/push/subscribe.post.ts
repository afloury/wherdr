export default defineApi(async (event, b) => {
  if (!pushReady()) throw new HerdrError('push_off', 'Web Push non configuré')
  if (!b || typeof b.endpoint !== 'string' || !b.keys) throw new HerdrError('bad_sub', 'abonnement invalide')
  const subs = (await readSubs()).filter(s => s.endpoint !== b.endpoint)
  const sessions: Record<string, string> = {}
  if (b.sessions && typeof b.sessions === 'object' && !Array.isArray(b.sessions)) {
    for (const [key, name] of Object.entries(b.sessions)) {
      if ((key === '' || /^[0-9a-f]{4,32}$/.test(key)) && typeof name === 'string' && /^[\w.-]{1,64}$/.test(name)) sessions[key] = name
    }
  }
  subs.push({ endpoint: b.endpoint, keys: b.keys, lang: b.lang === 'en' ? 'en' : 'fr',
    notifyScope: b.notifyScope === 'all' ? 'all' : 'project_leads', sessions, addedAt: new Date().toISOString() })
  await writeSubs(subs)
  log(`push : abonnement enregistré (${subs.length} appareil(s))`)
  return { ok: true, devices: subs.length }
})
