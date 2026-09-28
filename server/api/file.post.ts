// Pièce jointe depuis un terminal sur ordinateur : nom généré côté serveur,
// extension conservée si sûre. Le chemin retourné est envoyé au pane.
export default defineApi((event, b) => {
  const pane = String(getQuery(event).pane || '')
  const ext = String(getQuery(event).ext || '')
  return saveUpload(b.data, b.ctype, PANE_RE.test(pane) ? pane : null, ext)
}, { raw: /^application\/octet-stream$/ })
