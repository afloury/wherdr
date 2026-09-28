// Mode silence : lecture (sans `scope`) ou réglage, pour cet appareil
// (abonnement `endpoint`) ou pour tous. Réponse : les deux silences en cours.
import { parseQuiet, quietActive } from '../../../shared/quiet'

export default defineApi(async (event, b) => {
  const endpoint = typeof b.endpoint === 'string' ? b.endpoint : ''
  if (b.scope !== undefined) {
    const quiet = parseQuiet(b.on, b.until)
    if (quiet === undefined || (b.scope !== 'device' && b.scope !== 'all')) throw new HerdrError('bad_quiet', 'réglage de silence invalide')
    if (b.scope === 'all') await writeGlobalQuiet(quiet)
    else {
      const subs = await readSubs()
      const sub = subs.find(s => s.endpoint === endpoint)
      if (!sub) throw new HerdrError('no_sub', 'notifications non activées sur cet appareil')
      if (quiet) sub.quiet = quiet
      else delete sub.quiet
      await writeSubs(subs)
    }
    log(`push : silence ${b.scope === 'all' ? 'tous les appareils' : 'un appareil'} ${quiet ? (quiet.until ? `jusqu'à ${new Date(quiet.until).toISOString()}` : 'jusqu’à réactivation') : 'coupé'}`)
  }
  const device = endpoint ? (await readSubs()).find(s => s.endpoint === endpoint)?.quiet : undefined
  return { global: await readGlobalQuiet(), device: device && quietActive(device) ? device : null }
})
