// Attachment from a terminal on a computer: name generated on the server,
// extension kept if safe. The returned path is sent to the pane.
export default defineApi((event, b) => {
  const pane = String(getQuery(event).pane || '')
  const ext = String(getQuery(event).ext || '')
  return saveUpload(b.data, b.ctype, PANE_RE.test(pane) ? pane : null, ext)
}, { raw: /^application\/octet-stream$/ })
