// Photo envoyée depuis le téléphone (déjà réduite en JPEG par le navigateur).
// `pane` : l'agent destinataire (sa machine reçoit une copie de la photo).
export default defineApi((event, b) => {
  const pane = String(getQuery(event).pane || '')
  return saveUpload(b.data, b.ctype, PANE_RE.test(pane) ? pane : null)
}, { raw: /^image\/(jpeg|png|webp|gif|heic)$/ })
