// Icônes de l'app (/icons/*, /favicon.ico), servies par le serveur et non comme
// fichiers statiques : une installation peut les remplacer sans reconstruire
// l'image, en montant ses propres icônes dans BRANDING_DIR (même arborescence :
// icons/<nom>.png, favicon.ico ; cf. docker-compose.override.example.yml).
// À défaut, celles du dépôt (server/assets/branding, embarquées au build).
import fs from 'node:fs'
import path from 'node:path'
import type { H3Event } from 'h3'

const BRANDING_DIR = process.env.BRANDING_DIR || ''
const TYPES: Record<string, string> = { png: 'image/png', svg: 'image/svg+xml', ico: 'image/x-icon' }

export async function serveBranding(event: H3Event, rel: string) {
  if (!/^(icons\/[\w.-]+\.(png|svg)|favicon\.ico)$/.test(rel)) return sendError(event, 404, { error: 'introuvable' })
  let body: Buffer | null = null
  if (BRANDING_DIR) {
    try { body = await fs.promises.readFile(path.join(BRANDING_DIR, rel)) }
    catch { body = null }
  }
  if (!body) {
    const raw = await useStorage('assets:server').getItemRaw(`branding/${rel}`)
    body = raw ? Buffer.from(raw as ArrayBuffer) : null
  }
  if (!body) return sendError(event, 404, { error: 'introuvable' })
  setResponseHeader(event, 'content-type', TYPES[rel.split('.').pop()!]!)
  setResponseHeader(event, 'cache-control', 'public, max-age=86400')
  return body
}
