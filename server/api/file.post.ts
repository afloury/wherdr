// Attachment from a terminal on a computer: name generated on the server,
// extension kept if safe. The returned path is sent to the pane.
export default defineApi((event, b) => {
  const q = getQuery(event)
  return corePutFile(coreInputDeps(), String(q.pane || ''), String(q.ext || ''), b.data)
}, { raw: /^application\/octet-stream$/ })
