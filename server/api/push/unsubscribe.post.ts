export default defineApi(async (event, b) => {
  const subs = (await readSubs()).filter(s => s.endpoint !== (b && b.endpoint))
  await writeSubs(subs)
  return { ok: true, devices: subs.length }
})
