export default defineApi(async (event, b) => {
  if (process.env.WHERDR_BACKEND !== 'core') throw new HerdrError('unsupported', 'Needs herdr-core')
  return coreKeepSet(coreInputDeps(), b)
})
