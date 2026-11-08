// Ends every session on every device (lost or stolen device); keeps the keys.
// Push subscriptions and open WebSockets end at once too.
export default defineApi(async (event) => {
  const r = auth.lockAll(reqOf(event))
  await revokeEverywhere()
  return r
})
