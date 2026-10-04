// Ends every session on every device (lost or stolen device); keeps the keys.
export default defineApi(event => auth.lockAll(reqOf(event)))
