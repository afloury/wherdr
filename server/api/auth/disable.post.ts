// Turns the lock off: the keys go, every session and push subscription with them.
export default defineApi(async (event) => {
  const r = auth.disable(reqOf(event))
  await revokeEverywhere()
  return r
})
