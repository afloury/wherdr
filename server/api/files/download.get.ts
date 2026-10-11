// A file of the agent's machine, whole, as an attachment: the same paths and
// checks as its preview (files/read.get.ts), up to DOWNLOAD_BYTES.
import { attachmentHeader, readFileBytes, readWrittenBytes } from '../../utils/files'

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
  // Never shown nor run by the browser, only saved.
  setResponseHeader(event, 'content-type', 'application/octet-stream')
  setResponseHeader(event, 'content-disposition', attachmentHeader(f.name))
  setResponseHeader(event, 'x-content-type-options', 'nosniff')
  setResponseHeader(event, 'content-security-policy', "default-src 'none'; sandbox")
  return f.body
})
