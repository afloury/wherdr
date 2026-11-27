import { execFile } from 'node:child_process'
import type { ShellExec } from '../../server/utils/fsx'

// Local ShellExec helper for unit tests running scripts against synthetic roots.
export const localShell: ShellExec = (script, args = [], opts = {}) => new Promise((resolve) => {
  execFile('sh', ['-c', script, 'sh', ...args], { timeout: opts.timeoutMs ?? 15000, encoding: 'buffer', maxBuffer: (opts.maxBytes ?? 4 * 1024 * 1024) + 64 * 1024 }, (err, out, stderr) => {
    const e = err as (Error & { code?: unknown, killed?: boolean }) | null
    const code = !e ? 0 : e.killed ? 124 : typeof e.code === 'number' ? e.code : 1
    resolve({ code, stdout: out as Buffer, stderr: String(stderr || '') })
  })
})
