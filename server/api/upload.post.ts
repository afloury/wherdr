// Photo sent from the phone (already shrunk to JPEG by the browser).
// `pane`: the recipient agent (its machine receives a copy of the photo).
export default defineApi((event, b) => corePutPhoto(coreInputDeps(), String(getQuery(event).pane || ''), b.data, UPLOAD_TYPES[b.ctype] || 'jpg'),
  { raw: /^image\/(jpeg|png|webp|gif|heic)$/ })
