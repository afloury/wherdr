// Maximum duration since the passkey unlock, for every device.
export default defineApi((event, body) => auth.setMaxSession(reqOf(event), body?.days))
