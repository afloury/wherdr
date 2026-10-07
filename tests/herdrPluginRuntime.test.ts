// scripts/herdr-plugin.sh in native mode: Herdr runs the actions with its
// server's PATH, which may not contain node (n, nvm…). The runtime found at
// install time must be saved and used by start.
import { execFileSync, spawnSync } from 'node:child_process'
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const REPO = path.resolve(import.meta.dirname, '..')
const TOOLS = ['sh', 'dirname', 'basename', 'sed', 'tr', 'head', 'tail', 'cat', 'ps', 'grep', 'curl', 'mkdir', 'touch', 'wc', 'sleep', 'nohup', 'ls', 'sort', 'id', 'uname', 'rm', 'mv', 'mktemp', 'tar', 'printf', 'setsid']

async function freePort() {
  const srv = net.createServer()
  const ready = Promise.withResolvers<void>()
  srv.listen(0, '127.0.0.1', () => ready.resolve())
  await ready.promise
  const port = (srv.address() as net.AddressInfo).port
  const closed = Promise.withResolvers<void>()
  srv.close(() => closed.resolve())
  await closed.promise
  return port
}

function which(cmd: string) {
  const r = spawnSync('sh', ['-c', `command -v ${cmd}`], { encoding: 'utf8' })
  return r.status === 0 ? r.stdout.trim() : ''
}

describe.skipIf(process.platform === 'win32' || !which('curl'))('herdr plugin, native runtime', () => {
  let tmp: string, root: string, home: string, rt: string, minbin: string, port: number

  beforeEach(async () => {
    tmp = mkdtempSync(path.join(os.tmpdir(), 'wherdr-plugin-'))
    root = path.join(tmp, 'root'); home = path.join(tmp, 'home'); rt = path.join(tmp, 'rt'); minbin = path.join(tmp, 'minbin')
    for (const d of [path.join(root, 'scripts'), path.join(root, '.output', 'server'), home, rt, minbin]) mkdirSync(d, { recursive: true })
    cpSync(path.join(REPO, 'scripts', 'herdr-plugin.sh'), path.join(root, 'scripts', 'herdr-plugin.sh'))
    cpSync(path.join(REPO, 'herdr-plugin.toml'), path.join(root, 'herdr-plugin.toml'))
    cpSync(path.join(REPO, 'package.json'), path.join(root, 'package.json'))
    cpSync(path.join(REPO, 'bin'), path.join(root, 'bin'), { recursive: true })
    // Stand-in server: answers on $PORT like wherdr (its manifest names it).
    writeFileSync(path.join(root, '.output', 'server', 'index.mjs'),
      `import http from 'node:http'\nhttp.createServer((q, s) => s.end('{"name":"wherdr"}')).listen(Number(process.env.PORT), process.env.HOST)\n`)
    // node only in a version-manager-like folder; npm stubbed (no real build).
    symlinkSync(process.execPath, path.join(rt, 'node'))
    writeFileSync(path.join(rt, 'npm'), '#!/bin/sh\nexit 0\n'); chmodSync(path.join(rt, 'npm'), 0o755)
    for (const t of TOOLS) { const p = which(t); if (p) symlinkSync(p, path.join(minbin, t)) }
    port = await freePort()
  })

  afterEach(() => {
    const pidfile = path.join(home, 'wherdr', 'wherdr.pid')
    if (existsSync(pidfile)) try { process.kill(Number(readFileSync(pidfile, 'utf8'))) } catch {}
    rmSync(tmp, { recursive: true, force: true })
  })

  // Like Herdr's server: a bare environment whose PATH has no node.
  const run = (action: string, extraPath = '') => spawnSync('sh', [path.join(root, 'scripts', 'herdr-plugin.sh'), action], {
    cwd: root, encoding: 'utf8', timeout: 60_000,
    env: { HOME: home, PATH: extraPath ? `${extraPath}:${minbin}` : minbin, WHERDR_MODE: 'native', WHERDR_PORT: String(port) },
  })

  it('saves the runtime at install and starts with it from a PATH without node', () => {
    // Install (fetch of the npm package fails offline or for an unpublished version: stub build).
    const build = run('build', rt)
    expect(build.status, build.stderr).toBe(0)
    const conf = readFileSync(path.join(home, 'wherdr', 'plugin.env'), 'utf8')
    expect(conf).toContain(`WHERDR_RUNTIME=${path.join(rt, 'node')}`)

    expect(spawnSync('sh', ['-c', 'command -v node'], { env: { PATH: minbin } }).status).not.toBe(0)
    const start = run('start')
    expect(start.status, start.stderr).toBe(0)
    expect(start.stdout).toContain('wherdr started')
    const pid = readFileSync(path.join(home, 'wherdr', 'wherdr.pid'), 'utf8').trim()
    expect(execFileSync('ps', ['-o', 'args=', '-p', pid], { encoding: 'utf8' })).toContain(path.join(rt, 'node'))
    expect(run('stop').stdout).toContain('wherdr stopped')
  })

  it('finds a runtime in the usual folders when the saved one is gone', () => {
    expect(run('build', rt).status).toBe(0)
    unlinkSync(path.join(rt, 'node'))
    mkdirSync(path.join(home, '.n', 'bin'), { recursive: true })
    symlinkSync(process.execPath, path.join(home, '.n', 'bin', 'node'))
    const start = run('start')
    expect(start.status, start.stderr).toBe(0)
    // Unless the machine has a node 22 in /usr/local/bin or Homebrew, which is checked after ~/.n.
    expect(readFileSync(path.join(home, 'wherdr', 'plugin.env'), 'utf8')).toContain(`WHERDR_RUNTIME=${path.join(home, '.n', 'bin', 'node')}`)
  })

  it('reports a server that exits at startup with the end of its log, never "started"', () => {
    expect(run('build', rt).status).toBe(0)
    writeFileSync(path.join(root, '.output', 'server', 'index.mjs'), 'console.error("cannot open the Herdr socket"); process.exit(3)\n')
    const start = run('start')
    expect(start.status).toBe(1)
    expect(start.stdout).not.toContain('wherdr started')
    expect(start.stderr).toContain('wherdr exited at startup')
    expect(start.stderr).toContain('cannot open the Herdr socket')
  })
})
