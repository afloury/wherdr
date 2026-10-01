// Photo sent from the phone (already shrunk to JPEG by the browser).
// `pane`: the recipient agent (its machine receives a copy of the photo).
export default defineApi((event, b) => {
  const pane = String(getQuery(event).pane || '')
  return saveUpload(b.data, b.ctype, PANE_RE.test(pane) ? pane : null)
}, { raw: /^image\/(jpeg|png|webp|gif|heic)$/ })
