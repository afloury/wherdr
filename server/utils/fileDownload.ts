// A file of the agent's machine, whole, as an attachment: the same paths and
// checks as its preview (files/read.get.ts), up to DOWNLOAD_BYTES.
// `inline=1`: PDF bytes for the canvas preview and Open's native viewer, or a
// video streamed for the <video> preview and Open, at any size (200 whole,
// 206 for a Range); any other file is still only an attachment.
// GET and HEAD (files/download.get.ts, download.head.ts).
import type { H3Event } from 'h3'
import { getQuery, getRequestHeader, setResponseHeader, setResponseStatus } from 'h3'
import { attachmentHeader, isPdf, readFileBytes, readWrittenBytes, videoType } from './files'
import { HerdrError } from './herdr'
import { machineFor } from './actions'
import { defineApi } from './http'
import { findPane } from './state'
import { openVideo, openWrittenVideo, parseRange } from './videoStream'

import type { Pane } from '../../shared/types'

async function serveVideo(event: H3Event, p: Pane, q: Record<string, unknown>, type: string) {
  const m = machineFor(p.machine)
  const v = q.from === 'chat' ? await openWrittenVideo(m, p.cwd, q.path) : await openVideo(m, p.cwd!, q.path)
  // The browser drops a request (seek, closed player): the read stops with it.
  event.node.res.on('close', v.close)
  try {
    const modified = new Date(v.mtime * 1000).toUTCString()
    // Only ever a video type (nosniff): never rendered as a page, whatever the bytes.
    setResponseHeader(event, 'x-content-type-options', 'nosniff')
    setResponseHeader(event, 'accept-ranges', 'bytes')
    setResponseHeader(event, 'content-security-policy', "default-src 'none'; media-src 'self'; frame-ancestors 'self'")
    setResponseHeader(event, 'etag', v.etag)
    setResponseHeader(event, 'last-modified', modified)
    let range = getRequestHeader(event, 'range')
    // A range of another version of the file: the whole current one (RFC 9110 §13.1.5).
    const ifRange = getRequestHeader(event, 'if-range')?.trim()
    if (range !== undefined && ifRange !== undefined && ifRange !== v.etag && ifRange !== modified) range = undefined
    const r = parseRange(range, v.size)
    if (r.kind === 'none') {
      v.close()
      setResponseStatus(event, 416)
      setResponseHeader(event, 'content-range', `bytes */${v.size}`)
      setResponseHeader(event, 'content-type', 'text/plain')
      return ''
    }
    const start = r.kind === 'part' ? r.start : 0
    const len = r.kind === 'part' ? r.end - r.start + 1 : v.size
    setResponseStatus(event, r.kind === 'part' ? 206 : 200)
    if (r.kind === 'part') setResponseHeader(event, 'content-range', `bytes ${r.start}-${r.end}/${v.size}`)
    setResponseHeader(event, 'content-type', type)
    setResponseHeader(event, 'content-disposition', attachmentHeader(v.name, 'inline'))
    setResponseHeader(event, 'content-length', len)
    if (event.method === 'HEAD' || !len) {
      v.close()
      return ''
    }
    return v.read(start, len)
  } catch (e) {
    v.close()
    throw e
  }
}

export const fileDownload = defineApi(async (event) => {
  const q = getQuery(event)
  const p = findPane(String(q.pane || ''))
  if (!p) throw new HerdrError('bad_pane', 'Pane not found')
  if (q.from !== 'chat' && !p.cwd) throw new HerdrError('bad_cwd', 'This agent’s folder is unknown')
  const video = q.inline === '1' ? videoType(String(q.path || '')) : undefined
  if (video) return serveVideo(event, p, q, video)
  const f = q.from === 'chat'
    ? await readWrittenBytes(machineFor(p.machine), p.cwd, q.path)
    : await readFileBytes(machineFor(p.machine), p.cwd!, q.path)
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
