import fs from 'node:fs'
import path from 'node:path'
import { HERDR_AGENT_KINDS, availableAgentKinds } from '../../shared/launchableAgents'
import { AGENT_KINDS } from './env'
import type { Machine } from './machines'

const TTL = 30_000
const cache = new Map<string, { at: number, kinds: string[] }>()
const extraDirs = (home: string) => [
  path.join(home, '.local/bin'), path.join(home, '.kimi-code/bin'),
  path.join(home, '.bun/bin'), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin',
]

export async function installedAgentKinds(m: Machine): Promise<string[]> {
  const old = cache.get(m.key)
  if (old && Date.now() - old.at < TTL) return old.kinds
  const candidates = HERDR_AGENT_KINDS.filter(k => AGENT_KINDS.includes(k))
  let found: string[] = []
  if (m.local) {
    const dirs = [...extraDirs(m.home), ...(process.env.PATH || '').split(path.delimiter)]
    found = candidates.filter(k => dirs.some(d => {
      try { fs.accessSync(path.join(d, k), fs.constants.X_OK); return true }
      catch { return false }
    }))
  } else if (m.exec && m.status === 'online') {
    const script = `PATH="$HOME/.local/bin:$HOME/.kimi-code/bin:$HOME/.bun/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
for cmd do command -v "$cmd" >/dev/null 2>&1 && printf '%s\\n' "$cmd"; done; exit 0`
    const result = await m.exec(script, candidates, { timeoutMs: 10000 })
    if (result.code !== 0) return []
    const installed = new Set(result.stdout.toString('utf8').split('\n').filter(Boolean))
    found = candidates.filter(k => installed.has(k))
  }
  const kinds = availableAgentKinds(found, AGENT_KINDS)
  cache.set(m.key, { at: Date.now(), kinds })
  return kinds
}
