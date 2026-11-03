// "Keep after restart" of a terminal (herdr-core only).
export default defineApi(async (event) => {
  if (process.env.WHERDR_BACKEND !== 'core') throw new HerdrError('unsupported', 'Needs herdr-core')
  return coreKeepGet(coreInputDeps(), String(getQuery(event).pane || ''))
})
