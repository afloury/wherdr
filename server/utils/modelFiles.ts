// Files of on-device dictation (models and WASM runtimes) under
// DATA_DIR/models, served by /models/**. They are large (13 MB to 1 GB),
// fetched once by scripts/fetch-dictation-files.mjs and kept out of the npm
// package and the service worker precache. Ported from followcat's
// server/routes/models/[...path].get.ts (branch mobile, MIT).
import { createReadStream } from 'node:fs'
import { realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'
import { answer } from './videoStream'

// Exact types: importScripts and WebAssembly.instantiateStreaming refuse a
// wrong MIME under nosniff.
const MIME: Record<string, string> = {
  '.wasm': 'application/wasm',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
}

export function modelMime(file: string): string {
  return MIME[path.extname(file).toLowerCase()] || 'application/octet-stream'
}

// The file under root that rel names, or null when it is missing, not a
// regular file, or outside root (.., an absolute path, a symlink leading out).
export async function resolveModelFile(root: string, rel: string): Promise<string | null> {
  let name: string
  try { name = decodeURIComponent(rel) } catch { return null }
  if (!name || name.includes('\0')) return null
  const base = await realpath(root).catch(() => null)
  if (!base) return null
  const file = await realpath(path.resolve(base, name)).catch(() => null)
  if (!file || !file.startsWith(base + path.sep)) return null
  const st = await stat(file).catch(() => null)
  return st?.isFile() ? file : null
}

// Whole (200), one byte range (206, one Range rule for every route:
// videoStream.ts) or 416. A Web Response: h3 keeps its headers, which
// sendStream drops on this version (followcat's finding).
export async function serveModelFile(root: string, rel: string, req: { method?: string, range?: string } = {}): Promise<Response> {
  const file = await resolveModelFile(root, rel)
  if (!file) return new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } })
  const { size } = await stat(file)
  const headers: Record<string, string> = {
    'content-type': modelMime(file),
    // Private: the route sits behind the passkey lock, a shared cache must not
    // keep it. Immutable: a new version gets a new folder name.
    'cache-control': 'private, max-age=31536000, immutable',
    'accept-ranges': 'bytes',
  }
  const a = answer({ size, etag: '' }, { method: req.method || 'GET', range: req.range })
  if (a.contentRange) headers['content-range'] = a.contentRange
  if (a.status === 416) return new Response(null, { status: 416, headers })
  headers['content-length'] = String(a.len)
  const body = a.len && req.method !== 'HEAD'
    ? Readable.toWeb(createReadStream(file, { start: a.start, end: a.start + a.len - 1 })) as ReadableStream
    : null
  return new Response(body, { status: a.status, headers })
}
