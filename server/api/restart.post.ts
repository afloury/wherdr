import { dismissRestart, restartAgent } from '../utils/restart'

// Redémarrer un agent dans son pane en reprenant sa conversation (cf.
// server/utils/restart.ts). Rend la main tout de suite : le suivi passe par
// `pane.restart` dans l'état. `dismiss` efface un échec affiché.
export default defineApi(async (event, b) => {
  if (!PANE_RE.test(b.pane_id || '')) throw new HerdrError('bad_pane', 'pane invalide')
  if (b.dismiss === true) {
    dismissRestart(b.pane_id)
    return { ok: true }
  }
  const plan = await restartAgent(b.pane_id)
  return { ok: true, mode: plan.mode }
})
