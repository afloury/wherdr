// Files attached to a message (PDF, text, code, notebooks): stored on the
// machine where the agent runs, the message carries their path. Photos keep
// their own route (actions.ts saveUpload). Checks in shared/attachments.ts.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { ATTACH_DIR, UPLOAD_TTL_MS, log } from './env'
import { HerdrError } from './herdr'
import { findPane } from './state'
import { RemoteMachine, machineOfPane } from './machines'
import { fmt } from '../../shared/message'
import { SNIFF_BYTES, attachmentRef, checkAttachment, isStoredAttachmentName, storedAttachmentName, type RefuseReason } from '../../shared/attachments'

const fsp = fs.promises

const REFUSED: Record<RefuseReason, string> = {
  archive: 'Archives cannot be read by the agent: extract the files first',
  video: 'Videos cannot be read by the agent',
  audio: 'Audio files cannot be read by the agent',
  office: 'Office documents cannot be read by the agent: export to PDF or text first',
  executable: 'Programs and binary files cannot be read by the agent',
  binary: 'Binary files cannot be read by the agent',
  pdf: 'This agent cannot read PDFs: only Claude Code can',
  too_large: 'File too large for the agent',
  empty: 'Empty file',
}

export async function saveAttachment(data: Buffer, originalName: string, paneId: string) {
  const pane = findPane(paneId)
  const m = machineOfPane(paneId)
  if (!pane || !m) throw new HerdrError('bad_pane', 'Pane not found')
  const check = checkAttachment(pane.agent, { name: originalName, type: '', size: data.length }, data.subarray(0, SNIFF_BYTES))
  // Photos go through /api/upload (shrunk in the browser).
  if (check.ok && check.kind === 'image') throw new HerdrError('unsupported', 'Images go through the photo upload')
  if (!check.ok) throw new HerdrError(check.reason === 'too_large' ? 'too_large' : 'unsupported', REFUSED[check.reason])
  const stored = storedAttachmentName(originalName, new Date(), crypto.randomBytes(3).toString('hex'))
  if (!isStoredAttachmentName(stored)) throw new HerdrError('bad_name', 'Invalid file name')
  let file: string
  if (m instanceof RemoteMachine) {
    if (m.status !== 'online') throw new HerdrError('unreachable', fmt('{machine} is unreachable', { machine: m.label }))
    file = await m.putUpload(stored, data, 'file')
  } else {
    file = path.join(ATTACH_DIR, stored)
    if (path.dirname(file) !== path.resolve(ATTACH_DIR)) throw new HerdrError('bad_name', 'Invalid file name')
    await fsp.mkdir(ATTACH_DIR, { recursive: true, mode: 0o700 })
    // Exclusive creation, mode 600: never executable, never over another file.
    await fsp.writeFile(file, data, { mode: 0o600, flag: 'wx' })
  }
  log(`file received ${stored} (${Math.round(data.length / 1024)} KB, ${check.kind})${m instanceof RemoteMachine ? ` -> ${m.label}` : ''}`)
  return { path: file, name: stored, kind: check.kind, size: data.length, ref: attachmentRef(pane.agent, check.kind, file) }
}

export async function cleanAttachments() {
  try {
    for (const n of await fsp.readdir(ATTACH_DIR)) {
      const f = path.join(ATTACH_DIR, n)
      const st = await fsp.lstat(f)
      if (st.isFile() && Date.now() - st.mtimeMs > UPLOAD_TTL_MS) await fsp.unlink(f)
    }
  } catch { /* folder missing */ }
}
