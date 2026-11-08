// Root of the Git repository containing a folder, on the pane's machine.
import { execFile } from 'node:child_process'
import type { Machine } from './machines'

type Run = (script: string, args: string[], timeout?: number) => Promise<Buffer>
// `signal`: the local command is killed with it (the SSH executor shares
// identical running commands between callers and takes no signal).
function runner(m: Machine, signal?: AbortSignal): Run {
  const remoteExec = m.exec
  if (remoteExec) return async (script, args, timeout = 12000) => {
    const r = await remoteExec(script, args, { timeoutMs: timeout })
    if (r.code !== 0) throw new Error(r.stderr.trim() || `Git : code ${r.code}`)
    return r.stdout
  }
  return (script, args, timeout = 12000) => new Promise((resolve, reject) => {
    execFile('sh', ['-c', script, 'sh', ...args], { timeout, encoding: 'buffer', maxBuffer: 512 * 1024, signal }, (err, out, stderr) => {
      if (err) reject(new Error(String(stderr || err.message).trim()))
      else resolve(out as Buffer)
    })
  })
}

const git = 'git --no-optional-locks -c core.fsmonitor=false -c core.hooksPath=/dev/null -c core.quotePath=false -c diff.external='

// Root of the Git repository containing `cwd` (empty outside a repository), same read-only options.
export async function gitToplevel(m: Machine, cwd: string, signal?: AbortSignal): Promise<string> {
  const out = await runner(m, signal)(`cd "$1" 2>/dev/null && ${git} rev-parse --show-toplevel 2>/dev/null || true`, [cwd]).catch(() => Buffer.alloc(0))
  return out.toString('utf8').trim()
}
