// Text left unsent in Claude's input box, or its queue (herdr-core only, WHR-286):
// action "send" (Enter), "clear" (empty the box) or "send-queued" (ctrl+enter).
export default defineApi(async (_event, b) => {
  if (process.env.WHERDR_BACKEND !== 'core') throw new HerdrError('unsupported', 'Only with herdr-core')
  return coreDraft(coreDraftDeps(), b)
})
