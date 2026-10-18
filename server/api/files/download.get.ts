// A file of the agent's machine, whole, as an attachment: the same paths and
// checks as its preview (files/read.get.ts), up to DOWNLOAD_BYTES.
// `inline=1`: PDF bytes for the canvas preview and Open's native viewer, or a
// video in pieces (Range, 206) for the <video> preview and Open, at any size;
// any other file is still only an attachment.
import { getRequestHeader, setResponseStatus } from 'h3'
import { attachmentHeader, isPdf, readFileBytes, readFileRange, readWrittenBytes, readWrittenRange, videoType } from '../../utils/files'

export default defineApi(async (event) => {
  const q = getQuery(event)
  const p = findPane(String(q.pane || ''))
  if (!p) throw new HerdrError('bad_pane', 'Pane not found')
  if (q.from !== 'chat' && !p.cwd) throw new HerdrError('bad_cwd', 'This agent’s folder is unknown')
  const video = q.inline === '1' ? videoType(String(q.path || '')) : undefined
  if (video) {
    // Safari plays nothing without 206 answers. Only ever a video type
    // (nosniff): never rendered as a page, whatever the bytes.
    const header = getRequestHeader(event, 'range')
    const f = q.from === 'chat'
      ? await readWrittenRange(machineFor(p.machine), p.cwd, q.path, header)
      : await readFileRange(machineFor(p.machine), p.cwd!, q.path, header)
    setResponseHeader(event, 'x-content-type-options', 'nosniff')
    setResponseHeader(event, 'accept-ranges', 'bytes')
    setResponseHeader(event, 'content-security-policy', "default-src 'none'; media-src 'self'; frame-ancestors 'self'")
    if (!f.range) {
      setResponseStatus(event, 416)
      setResponseHeader(event, 'content-range', `bytes */${f.size}`)
      return ''
    }
    setResponseStatus(event, 206)
    setResponseHeader(event, 'content-type', video)
    setResponseHeader(event, 'content-disposition', attachmentHeader(f.name, 'inline'))
    setResponseHeader(event, 'content-range', `bytes ${f.range.start}-${f.range.end}/${f.size}`)
    setResponseHeader(event, 'content-length', f.body.length)
    return f.body
  }
  let f: { name: string, body: Buffer }
  if (q.from === 'chat') f = await readWrittenBytes(machineFor(p.machine), p.cwd, q.path)
  else f = await readFileBytes(machineFor(p.machine), p.cwd!, q.path)
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
