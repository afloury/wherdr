// Press a key from the legend of a waiting screen ("t trust all",
// "esc close"…), at the user's request only. The screen is re-read
// just before: if the legend changed, we refuse rather than press blindly.
export default defineApi(async (event, b) => {
  if (!PANE_RE.test(b.pane_id || '')) throw new HerdrError('bad_pane', 'Invalid pane')
  const r = await herdr('pane.read', { pane_id: b.pane_id, source: 'detection' }, 4000)
  const text = r.read && r.read.text
  const screen = parseWaitScreen(text, { choices: Boolean(parseChoices(text, { strict: true })) })
  const a = screen && screen.actions.find(x => x.key === b.key && x.label === b.label)
  if (!a) throw new HerdrError('stale', 'The screen has changed — check the current screen.')
  // Always as a key, letters included: sent as text (paste), Codex ignores "t".
  await herdr('pane.send_input', { pane_id: b.pane_id, keys: [a.key] })
  choicesCache.delete(b.pane_id)
  setTimeout(poll, 300)
  return { ok: true }
})
