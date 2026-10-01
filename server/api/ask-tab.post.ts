// Tabs of omp's "Ask" box (several questions): go to a question or to Submit,
// like ←/→ in the terminal. The screen and the tab shown are re-read just
// before: the number of ←/→ is counted from the tab actually shown.
export default defineApi(async (event, b) => {
  if (!PANE_RE.test(b.pane_id || '')) throw new HerdrError('bad_pane', 'Invalid pane')
  const pane: string = b.pane_id
  const r = await herdr('pane.read', { pane_id: pane, source: 'detection' }, 4000)
  const shown = screenChoices(r.read && r.read.text, findPane(pane)?.agent)
  const c = shown && !shown.typing ? await withOmpTab(pane, shown) : null
  const i = Number(b.index)
  if (!c || !c.tabs || c.tab === undefined || c.tabs[i] !== b.label) {
    throw new HerdrError('stale', 'The screen has changed — check the current screen.')
  }
  const d = i - c.tab
  if (d) await herdr('pane.send_input', { pane_id: pane, keys: Array.from({ length: Math.abs(d) }, () => (d > 0 ? 'right' : 'left')) })
  watchScreen(pane, 30000)
  for (const ms of [50, 150, 400]) setTimeout(() => { choicesCache.delete(pane); poll() }, ms)
  return { ok: true }
})
