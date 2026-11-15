// Files attached to a message (PDF, text, code, notebooks): stored on the
// machine where the agent runs (see corePut.ts), the message carries their
// path. Checks in shared/attachments.ts.
import fs from 'node:fs'
import path from 'node:path'
import { ATTACH_DIR, UPLOAD_TTL_MS } from './env'
import type { RefuseReason } from '../../shared/attachments'

const fsp = fs.promises

export const REFUSED: Record<RefuseReason, string> = {
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

export async function cleanAttachments() {
  try {
    for (const n of await fsp.readdir(ATTACH_DIR)) {
      const f = path.join(ATTACH_DIR, n)
      const st = await fsp.lstat(f)
      if (st.isFile() && Date.now() - st.mtimeMs > UPLOAD_TTL_MS) await fsp.unlink(f)
    }
  } catch { /* folder missing */ }
}
