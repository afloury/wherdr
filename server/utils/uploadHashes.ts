// Photos sent from wherdr reach the agent as a path line ("<home>/.cache/herdr-web/uploads/<name>"),
// not as an image in its transcript; and an agent reading that file back may
// re-encode it (omp's `read` returns WebP). So the photo's own bytes are what
// identify it: the user's message carries the hash of each photo it shows, and
// an action that read one of them back carries that same hash, to be shown as
// "same image as above" (see shared/imageDupes.ts).
import { createHash } from 'node:crypto'
import fsp from 'node:fs/promises'
import path from 'node:path'
import type { ChatItem } from '../../shared/types'
import { uploadNames } from '../../shared/queuedMatch'
import { UPLOAD_DIR } from './env'

const UPLOAD_PATH = /\.cache\/herdr-web\/uploads\/([\w-]+\.[a-z]+)/g
// Stored photos never change (unique names): each is hashed once.
const CACHE_MAX = 500
const cache = new Map<string, string | null>()

async function uploadHash(dir: string, name: string): Promise<string | null> {
  const key = `${dir}\n${name}`
  if (cache.has(key)) return cache.get(key)!
  let hash: string | null = null
  try { hash = createHash('sha256').update(await fsp.readFile(path.join(dir, path.basename(name)))).digest('hex') }
  catch { hash = null }
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!)
  cache.set(key, hash)
  return hash
}

export async function addUploadHashes(items: ChatItem[], dir = UPLOAD_DIR): Promise<void> {
  for (const it of items) {
    if (it.role === 'user') {
      const names = uploadNames(it.text)
      if (!names.length) continue
      const own = (await Promise.all(names.map(n => uploadHash(dir, n)))).filter((h): h is string => !!h)
      const hashes = [...(it.hashes || []), ...own.filter(h => !it.hashes?.includes(h))]
      if (hashes.length) it.hashes = hashes
    } else if (it.images === 1) {
      // An action that returned one image read from one stored photo.
      const names = [...new Set([...`${it.text}\n${it.omp?.target || ''}`.matchAll(UPLOAD_PATH)].map(m => m[1]!))]
      if (names.length !== 1) continue
      const h = await uploadHash(dir, names[0]!)
      if (h) it.hashes = [h]
    }
  }
}
