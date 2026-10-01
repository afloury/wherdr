// Piloter un menu interactif de Claude Code (/resume, /mcp…), à la demande de
// l'utilisateur seulement. L'écran est relu avant chaque touche : si le menu a
// changé (ou s'est fermé), on refuse plutôt que d'appuyer à l'aveugle.
//   op 'select' : aller jusqu'à l'entrée (une flèche à la fois, écran relu), puis
//                 Entrée, sauf si Entrée n'est pas un simple choix (cf. clickMovesOnly) ;
//   op 'key'    : une touche de la légende (Échap, Espace…) ;
//   op 'search' : remplacer le texte du champ de recherche.
import type { InteractiveMenu } from '../../shared/types'
import { clickMovesOnly, findEntry, searchKeys, stepToward } from '../../shared/menuScreen'

const STALE = 'Le menu a changé entre-temps — regarde l’écran à jour.'
// Position du curseur : rang et libellé (une liste qui défile garde le rang).
const at = (m: InteractiveMenu | null) => (m && m.cursor !== null ? `${m.cursor}:${m.items[m.cursor]!.label}` : null)
const send = (pane: string, keys: string[]) => herdr('pane.send_input', { pane_id: pane, keys })

export default defineApi(async (event, b) => {
  if (!PANE_RE.test(b.pane_id || '')) throw new HerdrError('bad_pane', 'Invalid pane')
  const pane: string = b.pane_id
  let menu = await readMenu(pane)
  if (!menu) throw new HerdrError('stale', STALE)

  if (b.op === 'key') {
    const a = menu.actions.find(x => x.key === b.key && x.label === b.label)
    if (!a) throw new HerdrError('stale', STALE)
    await send(pane, [a.key])
  } else if (b.op === 'search') {
    const text = String(b.text ?? '').replace(/[\r\n\t]/g, ' ').slice(0, 100)
    if (menu.search === null) throw new HerdrError('stale', STALE)
    const keys = searchKeys(menu.search, text)
    // Une touche par appel : plusieurs caractères d'un coup sont pris pour un
    // collage, que le champ de recherche de Claude Code ignore.
    for (const k of keys) { await send(pane, [k]); await sleep(25) }
  } else if (b.op === 'select') {
    const label = String(b.label || '')
    let target = findEntry(menu, Number(b.index), label)
    for (let n = 0; n < 60; n++) {
      if (target < 0) throw new HerdrError('stale', STALE)
      const step = stepToward(menu, target)
      if (!step) throw new HerdrError('stale', 'Cette entrée ne se choisit pas — regarde le terminal.')
      // Entrée qui n'est pas un simple choix (/model : « set as default ») : jamais sur un clic d'entrée.
      if (step === 'enter' && (b.move || clickMovesOnly(menu))) break
      await send(pane, [step])
      if (step === 'enter') break
      const before = at(menu)
      await sleep(120)
      menu = await readMenu(pane)
      // Le curseur n'a pas bougé : on relit une fois, puis on abandonne.
      if (at(menu) === before) { await sleep(250); menu = await readMenu(pane) }
      if (!menu || at(menu) === before) throw new HerdrError('stale', 'Le curseur ne bouge pas — termine dans le terminal.')
      target = findEntry(menu, -1, label)
    }
  } else throw new HerdrError('bad_request', 'op invalide')

  watchScreen(pane, 30000)
  // /resume : la conversation reprise remplace l'ancienne ; la transcription
  // est recherchée à nouveau (ChatView recharge sur changement de session).
  if (b.op === 'select') for (const ms of [800, 2500, 6000]) setTimeout(() => transcripts.forget(pane), ms)
  setTimeout(poll, 300)
  return { ok: true }
})
