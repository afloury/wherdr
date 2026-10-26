// Large JSON answers (a page of a conversation, the Board, the state) gzipped
// when the browser takes it: several times smaller over a slow network. Only
// plain objects and arrays, as H3 would send them; small ones as they are.
import { gzipSync } from 'node:zlib'

export const GZIP_MIN = 8 * 1024
export function gzipBody(acceptEncoding: string | undefined, out: unknown): Buffer | null {
  const plain = Array.isArray(out) || (out !== null && typeof out === 'object' && Object.getPrototypeOf(out) === Object.prototype)
  if (!plain || !/\bgzip\b/.test(acceptEncoding || '')) return null
  const json = JSON.stringify(out)
  return json.length < GZIP_MIN ? null : gzipSync(json, { level: 5 })
}
