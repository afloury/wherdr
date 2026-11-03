// Turns the lock off: the keys go, every session and push subscription with
// them; the open apps then subscribe again under the new generation.
export default defineApi(async (event) => {
  const r = auth.disable(reqOf(event))
  await revokeEverywhere()
  askPushResubscribe(eventClients.values())
  return r
})
