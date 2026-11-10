// Photos and files for an agent on herdr-core: terminal.put writes them beside
// the terminal, on its own machine (local or remote), and returns the path to
// put in the draft. Never retried: a timeout does not prove nothing was written.
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { HerdrError } from './herdr'
import { failure, type CoreInputDeps } from './coreInput'
import { REFUSED } from './attachments'
import { UPLOAD_DIR, log } from './env'
import { safeUploadExtension } from '../../shared/uploadName'
import { SNIFF_BYTES, attachmentRef, checkAttachment, isStoredAttachmentName, storedAttachmentName } from '../../shared/attachments'

// core's limit for one terminal.put (raw bytes).
export const CORE_PUT_MAX = 8 * 1024 * 1024
const TOO_LARGE = 'File too large for herdr-core (8 MB max)'

export async function corePut(deps: CoreInputDeps, paneId: unknown, name: string, data: Buffer) {
  const p = typeof paneId === 'string' ? deps.pane(paneId) : undefined
  if (!p?.coreAddress) throw new HerdrError('bad_pane', 'Pane not found')
  if (!data.length) throw new HerdrError('empty', 'Empty file')
  if (data.length > CORE_PUT_MAX) throw new HerdrError('too_large', TOO_LARGE)
  try {
    const r = await deps.call<{ path: string }>('terminal.put', { terminal: p.coreAddress, name, data: data.toString('base64') }, 60000)
    if (!r || typeof r.path !== 'string' || !r.path) throw new HerdrError('internal', 'herdr-core did not return a path')
    log(`file put ${name} (${Math.round(data.length / 1024)} KB) -> ${p.coreAddress}`)
    return r.path
  } catch (e) { failure(e) }
}

// Photo (shrunk by the browser): a local copy keeps its thumbnail after a reload.
export async function corePutPhoto(deps: CoreInputDeps, paneId: unknown, data: Buffer, ext: string) {
  const name = `${new Date().toISOString().replace(/[:.]/g, '-')}-${crypto.randomBytes(3).toString('hex')}.${ext}`
  const remote = await corePut(deps, paneId, name, data)
  try {
    await fs.promises.mkdir(UPLOAD_DIR, { recursive: true })
    await fs.promises.writeFile(path.join(UPLOAD_DIR, name), data, { mode: 0o600 })
  } catch { /* thumbnail only */ }
  return { path: remote, name }
}

// Same checks as v2 (kinds the agent reads), another transport.
export async function corePutAttachment(deps: CoreInputDeps, paneId: unknown, originalName: string, data: Buffer) {
  const p = typeof paneId === 'string' ? deps.pane(paneId) : undefined
  if (!p?.coreAddress) throw new HerdrError('bad_pane', 'Pane not found')
  if (data.length > CORE_PUT_MAX) throw new HerdrError('too_large', TOO_LARGE)
  const check = checkAttachment(p.agent, { name: originalName, type: '', size: data.length }, data.subarray(0, SNIFF_BYTES))
  if (check.ok && check.kind === 'image') throw new HerdrError('unsupported', 'Images go through the photo upload')
  if (!check.ok) throw new HerdrError(check.reason === 'too_large' ? 'too_large' : 'unsupported', REFUSED[check.reason])
  const stored = storedAttachmentName(originalName, new Date(), crypto.randomBytes(3).toString('hex'))
  if (!isStoredAttachmentName(stored)) throw new HerdrError('bad_name', 'Invalid file name')
  const remote = await corePut(deps, paneId, stored, data)
  return { path: remote, name: stored, kind: check.kind, size: data.length, ref: attachmentRef(p.agent, check.kind, remote) }
}

// Terminal paste/drop of any file: name generated here, extension kept if safe.
export async function corePutFile(deps: CoreInputDeps, paneId: unknown, ext: string, data: Buffer) {
  const name = `${new Date().toISOString().replace(/[:.]/g, '-')}-${crypto.randomBytes(3).toString('hex')}.${safeUploadExtension(ext)}`
  return { path: await corePut(deps, paneId, name, data), name }
}
