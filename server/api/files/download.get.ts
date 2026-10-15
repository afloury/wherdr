// A file of the agent's machine, whole, as an attachment: the same paths and
// checks as its preview (files/read.get.ts), up to DOWNLOAD_BYTES.
// `inline=1`: a PDF shown by the browser's own viewer (FilesView's preview);
// any other file is still only an attachment.
import { attachmentHeader, isPdf, readFileBytes, readWrittenBytes } from '../../utils/files'

export default defineApi(async (event) => {
  const q = getQuery(event)
  const p = findPane(String(q.pane || ''))
  if (!p) throw new HerdrError('bad_pane', 'Pane not found')
  let f: { name: string, body: Buffer }
  if (q.from === 'chat') f = await readWrittenBytes(machineFor(p.machine), p.cwd, q.path)
  else {
    if (!p.cwd) throw new HerdrError('bad_cwd', 'This agent’s folder is unknown')
    f = await readFileBytes(machineFor(p.machine), p.cwd, q.path)
  }
  setResponseHeader(event, 'x-content-type-options', 'nosniff')
  if (q.inline === '1' && isPdf(f.name, f.body)) {
    // Only ever a PDF (nosniff): the browser hands it to its PDF viewer, which
    // runs nothing in this origin. No `sandbox`: Chrome and Safari refuse to
    // show a PDF in a sandboxed document. Framed by the app only.
    setResponseHeader(event, 'content-type', 'application/pdf')
    setResponseHeader(event, 'content-disposition', attachmentHeader(f.name, 'inline'))
    setResponseHeader(event, 'content-security-policy', "default-src 'none'; object-src 'self'; frame-ancestors 'self'")
    setResponseHeader(event, 'cache-control', 'private, no-store')
    return f.body
  }
  // Never shown nor run by the browser, only saved.
  setResponseHeader(event, 'content-type', 'application/octet-stream')
  setResponseHeader(event, 'content-disposition', attachmentHeader(f.name))
  setResponseHeader(event, 'content-security-policy', "default-src 'none'; sandbox")
  return f.body
})
