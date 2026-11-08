// Public: the lock screen asks it. Rate-limited per client (clientKey).
export default defineApi(event => auth.loginOptions(reqOf(event), clientKey(event)))
