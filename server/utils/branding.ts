// App icons (/icons/*, /favicon.ico), served by the server and not as
// static files: an installation can replace them without rebuilding
// the image, by mounting its own icons in BRANDING_DIR (same layout:
// icons/<name>.png, favicon.ico; see docker-compose.override.example.yml).
// Otherwise, the repository's (server/assets/branding, bundled at build time).
import fs from 'node:fs'
import path from 'node:path'
import type { H3Event } from 'h3'

const BRANDING_DIR = process.env.BRANDING_DIR || ''
const TYPES: Record<string, string> = { png: 'image/png', svg: 'image/svg+xml', ico: 'image/x-icon' }

export async function serveBranding(event: H3Event, rel: string) {
  if (!/^(icons\/[\w.-]+\.(png|svg)|favicon\.ico)$/.test(rel)) return sendError(event, 404, { error: 'Not found' })
  let body: Buffer | null = null
  if (BRANDING_DIR) {
    try { body = await fs.promises.readFile(path.join(BRANDING_DIR, rel)) }
    catch { body = null }
  }
  if (!body) {
    const raw = await useStorage('assets:server').getItemRaw(`branding/${rel}`)
    body = raw ? Buffer.from(raw as ArrayBuffer) : null
  }
  if (!body) return sendError(event, 404, { error: 'Not found' })
  setResponseHeader(event, 'content-type', TYPES[rel.split('.').pop()!]!)
  setResponseHeader(event, 'cache-control', 'public, max-age=86400')
  return body
}
