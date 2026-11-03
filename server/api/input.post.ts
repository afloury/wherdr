// Keys from the key bar: the agent's screen is read again at the next polls, so a
// "Not sent" draft follows the key at once (and its Clear matches Claude's field).
export default defineApi(async (_event, b) => {
  const base = coreInputDeps()
  const id = typeof b.pane_id === 'string' ? b.pane_id : ''
  return coreInput({ ...base, refresh: () => { if (id) coreScreens().keyed(id); base.refresh() } }, b)
})
