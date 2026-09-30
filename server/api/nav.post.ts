// Clavier de l'ordinateur sur une carte « À toi » (menu interactif, invite à
// choix) : ↑ ↓ Entrée Échap envoyées telles quelles au terminal, comme la barre
// de touches. L'écran est relu avant : sans menu ni invite, on refuse. Entrée
// n'est jamais envoyée à un menu où elle n'est pas un simple choix (/model :
// « set as default »). L'état est rediffusé tout de suite après (écran relu).
import { TOP, clickMovesOnly } from '../../shared/menuScreen'

const KEYS = new Set(['up', 'down', 'enter', 'esc'])

export default defineApi(async (event, b) => {
  if (!PANE_RE.test(b.pane_id || '')) throw new HerdrError('bad_pane', 'pane invalide')
  const pane: string = b.pane_id
  const key = String(b.key || '')
  if (!KEYS.has(key)) throw new HerdrError('bad_request', 'touche invalide')
  const r = await herdr('pane.read', { pane_id: pane, source: 'detection' }, 4000)
  const text = r.read && r.read.text
  const framed = String(text || '').split('\n').some((l: string) => TOP.test(l))
  const menu = framed ? await readMenu(pane) : null
  if (menu) {
    if (key === 'enter' && clickMovesOnly(menu)) throw new HerdrError('stale', 'Entrée ne se valide pas d’ici — utilise les boutons.')
  } else if (!parseChoices(text) && !parseChoices(text, { strict: true })) {
    throw new HerdrError('stale', 'L’écran a changé entre-temps — regarde l’écran à jour.')
  }
  await herdr('pane.send_input', { pane_id: pane, keys: [key] })
  watchScreen(pane, 30000)
  // Relecture rapide : la nouvelle sélection s'affiche sans attendre le sondage.
  for (const ms of [50, 150, 400]) setTimeout(() => { choicesCache.delete(pane); poll() }, ms)
  return { ok: true }
})
