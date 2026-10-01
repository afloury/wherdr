// Drive an interactive Claude Code menu (/resume, /mcp…), at the user's
// request only. The screen is re-read before each key: if the menu has
// changed (or closed), we refuse rather than press blindly.
//   op 'select': go to the entry (one arrow at a time, screen re-read), then
//                Enter, unless Enter is not a simple choice (see clickMovesOnly);
//   op 'key'   : a key from the legend (Escape, Space…);
//   op 'search': replace the text of the search field.
import type { InteractiveMenu } from '../../shared/types'
import { clickMovesOnly, findEntry, searchKeys, stepToward } from '../../shared/menuScreen'

const STALE = 'The menu changed in the meantime — check the current screen.'
// Cursor position: rank and label (a scrolling list keeps the rank).
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
    // One key per call: several characters at once are taken as a
    // paste, which Claude Code's search field ignores.
    for (const k of keys) { await send(pane, [k]); await sleep(25) }
  } else if (b.op === 'select') {
    const label = String(b.label || '')
    let target = findEntry(menu, Number(b.index), label)
    for (let n = 0; n < 60; n++) {
      if (target < 0) throw new HerdrError('stale', STALE)
      const step = stepToward(menu, target)
      if (!step) throw new HerdrError('stale', 'This entry can’t be chosen here — check the terminal.')
      // Enter that is not a simple choice (/model: "set as default"): never on an entry click.
      if (step === 'enter' && (b.move || clickMovesOnly(menu))) break
      await send(pane, [step])
      if (step === 'enter') break
      const before = at(menu)
      await sleep(120)
      menu = await readMenu(pane)
      // The cursor did not move: re-read once, then give up.
      if (at(menu) === before) { await sleep(250); menu = await readMenu(pane) }
      if (!menu || at(menu) === before) throw new HerdrError('stale', 'The cursor doesn’t move — finish in the terminal.')
      target = findEntry(menu, -1, label)
    }
  } else throw new HerdrError('bad_request', 'Invalid operation')

  watchScreen(pane, 30000)
  // /resume: the resumed conversation replaces the old one; the transcript
  // is looked up again (ChatView reloads on session change).
  if (b.op === 'select') for (const ms of [800, 2500, 6000]) setTimeout(() => transcripts.forget(pane), ms)
  setTimeout(poll, 300)
  return { ok: true }
})
