// The node (22+) or bun that runs the server in the background or as a
// service, as an absolute path: launchd, systemd and Herdr's plugin actions
// do not have the PATH of your shell (n, nvm, fnm, Volta, asdf folders).
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export function nodeMajor(bin) {
  const r = spawnSync(bin, ['-p', 'process.versions.node'], { encoding: 'utf8', timeout: 10_000 })
  return r.status === 0 ? Number(r.stdout.trim().split('.')[0]) || 0 : 0
}

export const isBun = bin => path.basename(bin).replace(/\.exe$/, '') === 'bun'

export function runtimeOk(bin) {
  try {
    if (!bin || !path.isAbsolute(bin) || !existsSync(bin) || statSync(bin).isDirectory()) return false
  } catch { return false }
  if (isBun(bin)) return spawnSync(bin, ['--version'], { timeout: 10_000 }).status === 0
  return nodeMajor(bin) >= 22
}

export function runtimeVersion(bin) {
  const r = spawnSync(bin, ['--version'], { encoding: 'utf8', timeout: 10_000 })
  return r.status === 0 ? r.stdout.trim() : '?'
}

function onPath(name, env) {
  for (const dir of (env.PATH || '').split(path.delimiter)) {
    if (!dir) continue
    const p = path.join(dir, name)
    if (existsSync(p)) return p
  }
  return ''
}

// Newest first: v22.10.0 before v22.9.0.
function versions(dir) {
  try {
    return readdirSync(dir).filter(n => /^v?\d/.test(n)).sort((a, b) =>
      b.replace(/^v/, '').localeCompare(a.replace(/^v/, ''), 'en', { numeric: true }))
  } catch { return [] }
}

// Every place to look, in order: WHERDR_RUNTIME, the node running this command,
// node on the PATH, version managers, Homebrew and system folders, then Bun.
export function runtimeCandidates(env = process.env, home = os.homedir(), self = process.execPath) {
  const out = [env.WHERDR_RUNTIME]
  if (!process.versions.bun) out.push(self)
  out.push(onPath('node', env), path.join(home, '.n/bin/node'))
  if (env.N_PREFIX) out.push(path.join(env.N_PREFIX, 'bin/node'))
  for (const v of versions(path.join(home, '.nvm/versions/node'))) out.push(path.join(home, '.nvm/versions/node', v, 'bin/node'))
  out.push(path.join(home, '.volta/bin/node'))
  for (const base of [path.join(home, '.local/share/fnm/node-versions'), path.join(home, '.fnm/node-versions')]) {
    for (const v of versions(base)) out.push(path.join(base, v, 'installation/bin/node'))
  }
  out.push(path.join(home, '.asdf/shims/node'), '/opt/homebrew/bin/node', '/usr/local/bin/node', '/usr/bin/node')
  if (process.versions.bun) out.push(self)
  out.push(onPath('bun', env), path.join(home, '.bun/bin/bun'), '/opt/homebrew/bin/bun', '/usr/local/bin/bun')
  return [...new Set(out.filter(Boolean))]
}

export function findRuntime(env = process.env, home = os.homedir()) {
  return runtimeCandidates(env, home).find(runtimeOk) || null
}

export const RUNTIME_HELP = 'Node.js 22 or newer (or Bun) is needed. Install it from https://nodejs.org, or set WHERDR_RUNTIME=/absolute/path/to/node.'

// npx, pnpm dlx and bunx run packages from a cache folder that can vanish:
// no service may point there.
export function temporaryInstall(file) {
  return /[\\/](_npx|dlx|\.bun[\\/]install[\\/]cache)[\\/]|[\\/]bunx-[^\\/]*[\\/]/.test(file)
}
