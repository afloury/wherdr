// Computer keyboard on a "Your turn" card (interactive menu, choice
// prompt): ↑ ↓ Enter Escape sent as is to the terminal, like the key
// bar. The screen is re-read first: without a menu or prompt, we refuse. Enter
// is never sent to a menu where it is not a simple choice (/model:
// "set as default"). ← →: only between the tabs of omp's "Ask" box. The
// state is broadcast again right after (screen re-read).
import { TOP, clickMovesOnly } from '../../shared/menuScreen'

const KEYS = new Set(['up', 'down', 'enter', 'esc', 'left', 'right'])

export default defineApi(async (event, b) => {
  if (!PANE_RE.test(b.pane_id || '')) throw new HerdrError('bad_pane', 'Invalid pane')
  const pane: string = b.pane_id
  const key = String(b.key || '')
  if (!KEYS.has(key)) throw new HerdrError('bad_request', 'Invalid key')
  const r = await herdr('pane.read', { pane_id: pane, source: 'detection' }, 4000)
  const text = r.read && r.read.text
  const agent = findPane(pane)?.agent
  const framed = agent !== 'omp' && String(text || '').split('\n').some((l: string) => TOP.test(l))
  const menu = framed ? await readMenu(pane) : null
  if (menu) {
    if (key === 'enter' && clickMovesOnly(menu)) throw new HerdrError('stale', 'Enter doesn’t confirm from here — use the buttons.')
    if (key === 'left' || key === 'right') throw new HerdrError('stale', 'The screen has changed — check the current screen.')
  } else {
    const choices = screenChoices(text, agent)
    if (!choices || ((key === 'left' || key === 'right') && !(choices.tabs && !choices.typing))) {
      throw new HerdrError('stale', 'The screen has changed — check the current screen.')
    }
  }
  await herdr('pane.send_input', { pane_id: pane, keys: [key] })
  watchScreen(pane, 30000)
  // Quick re-read: the new selection shows without waiting for the poll.
  for (const ms of [50, 150, 400]) setTimeout(() => { choicesCache.delete(pane); poll() }, ms)
  return { ok: true }
})
