import { execFileSync, execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync, cpSync } from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { expect, it } from 'vitest'
import { driverFor, realIo } from '../bin/lib/updater.mjs'
import { ready, readiness, promote } from '../scripts/release-ready.mjs'

it('downloads a local release, verifies before extraction, and restores the previous plugin', async () => {
  const home = mkdtempSync(path.join(os.tmpdir(), 'wherdr-release-'))
  const pkg = path.join(home, 'package')
  mkdirSync(path.join(pkg, '.output/server'), { recursive: true })
  mkdirSync(path.join(pkg, 'skills/wherdr'), { recursive: true })
  mkdirSync(path.join(pkg, 'bin/lib'), { recursive: true })
  writeFileSync(path.join(pkg, '.output/server/index.mjs'), '// built server')
  writeFileSync(path.join(pkg, 'skills/wherdr/SKILL.md'), 'release skill')
  writeFileSync(path.join(pkg, 'package.json'), '{"version":"1.3.3"}')
  const tgz = path.join(home, 'release.tgz')
  execFileSync('tar', ['-czf', tgz, '-C', home, 'package'])
  const data = readFileSync(tgz)
  const sha = createHash('sha256').update(data).digest('hex')
  let corrupt = false
  const server = http.createServer((req, res) => {
    res.end(req.url?.endsWith('.sha256') ? `${corrupt ? '0'.repeat(64) : sha}  wherdr-1.3.3.tgz\n` : data)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
    const root = path.join(home, 'app')
    mkdirSync(root)
    writeFileSync(path.join(root, 'previous'), 'old')
    const plan = { kind: 'plugin', root, dir: home, to: '1.3.3', releaseBase: base, runtime: process.execPath }
    const driver = driverFor(plan, realIo(plan))
    await driver.install()
    expect(readFileSync(`${root}.new/skills/wherdr/SKILL.md`, 'utf8')).toBe('release skill')
    await driver.activate()
    await driver.rollback()
    expect(readFileSync(path.join(root, 'previous'), 'utf8')).toBe('old')
    corrupt = true
    await expect(driver.install()).rejects.toThrow('SHA-256 mismatch')
    expect(existsSync(`${root}.new`)).toBe(false)

    // Execute the production shell downloader in an isolated HOME, rewriting
    // only its URL to this local fixture server.
    const script = readFileSync('scripts/herdr-plugin.sh', 'utf8')
    const fn = script.slice(script.indexOf('fetch_prebuilt()'), script.indexOf('# qrcode-terminal'))
      .replace('https://github.com/$SOURCE/releases/download', base)
    const checkout = path.join(home, 'checkout')
    mkdirSync(path.join(checkout, 'bin/lib'), { recursive: true })
    cpSync('bin/lib/verify-release.mjs', path.join(checkout, 'bin/lib/verify-release.mjs'))
    writeFileSync(path.join(checkout, 'herdr-plugin.toml'), 'version = "1.3.3"\n')
    const shell = path.join(home, 'download.sh')
    writeFileSync(shell, `set -eu\nROOT="$1"\nRUNTIME="$2"\nok() { :; }\n${fn}\nfetch_prebuilt\n`)
    const run = () => promisify(execFile)('sh', [shell, checkout, process.execPath], { env: { ...process.env, HOME: home } })
    await expect(run()).rejects.toThrow()
    expect(existsSync(path.join(checkout, '.output'))).toBe(false)
    corrupt = false
    await run()
    expect(readFileSync(path.join(checkout, 'skills/wherdr/SKILL.md'), 'utf8')).toBe('release skill')
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()))
    rmSync(home, { recursive: true, force: true })
  }
})

it('advances the legacy channel only after npm latest, the tarball, and Homebrew are ready', async () => {
  for (const missing of ['metadata', 'tag', 'tarball', 'formula', 'none']) {
    const fetcher = async (url: string) => ({
      ok: !((url.endsWith('/latest') && missing === 'metadata') || (url.endsWith('.tgz') && missing === 'tarball')),
      json: async () => ({ version: missing === 'tag' ? '1.3.2' : '1.3.3' }),
      text: async () => missing === 'formula' ? 'old' : 'url "https://github.com/example/wherdr/releases/download/v1.3.3/wherdr-1.3.3.tgz"',
    })
    expect(await ready('1.3.3', fetcher, 'example/wherdr')).toBe(missing === 'none')
  }
})

for (const scenario of [
  { github: true, npm: true, version: '1.3.3', runtime: 'node' },
  { github: false, npm: true, version: '1.3.2', runtime: 'node' },
  { github: false, npm: true, version: '1.3.2', runtime: 'bun' },
  { github: false, npm: false, version: '1.3.3', runtime: 'node' },
]) {
  it(`uses prebuilt sources before compilation: ${JSON.stringify(scenario)}`, async () => {
    const home = mkdtempSync(path.join(os.tmpdir(), 'wherdr-sources-'))
    const pkg = path.join(home, 'package')
    const checkout = path.join(home, 'checkout')
    mkdirSync(path.join(pkg, '.output/server'), { recursive: true })
    mkdirSync(path.join(pkg, 'bin'), { recursive: true })
    mkdirSync(path.join(checkout, 'bin/lib'), { recursive: true })
    mkdirSync(path.join(checkout, 'skills/wherdr'), { recursive: true })
    writeFileSync(path.join(checkout, 'skills/wherdr/SKILL.md'), 'checkout skill for legacy npm')
    writeFileSync(path.join(pkg, '.output/server/index.mjs'), '// prebuilt')
    writeFileSync(path.join(pkg, 'package.json'), JSON.stringify({ version: scenario.version }))
    cpSync('bin/lib/verify-release.mjs', path.join(checkout, 'bin/lib/verify-release.mjs'))
    writeFileSync(path.join(checkout, 'herdr-plugin.toml'), `version = "${scenario.version}"\n`)
    const archive = path.join(home, 'package.tgz')
    execFileSync('tar', ['-czf', archive, '-C', home, 'package'])
    const data = readFileSync(archive)
    const requests: string[] = []
    const server = http.createServer((req, res) => {
      const url = req.url || ''
      requests.push(url)
      const enabled = url.startsWith('/github/') ? scenario.github : scenario.npm
      if (!enabled) { res.writeHead(404); res.end('missing'); return }
      if (url.endsWith('.sha256')) res.end(createHash('sha256').update(data).digest('hex'))
      else if (url.endsWith('.tgz')) res.end(data)
      else res.end(JSON.stringify({ name: 'wherdr', version: scenario.version, dist: {
        integrity: `sha512-${createHash('sha512').update(data).digest('base64')}`,
      } }))
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    try {
      const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
      const script = readFileSync('scripts/herdr-plugin.sh', 'utf8')
      const downloader = script.slice(script.indexOf('fetch_prebuilt()'), script.indexOf('# qrcode-terminal'))
        .replace('https://github.com/$SOURCE/releases/download', `${base}/github`)
        .replaceAll('https://registry.npmjs.org', `${base}/npm`)
      const builder = script.slice(script.indexOf('build_native()'), script.indexOf('# Copies the commands'))
      const runtime = path.join(home, scenario.runtime)
      // Node executes the verification helper in both cases; the bun basename
      // exercises build_native's Bun-only path without a Bun installation.
      const { symlinkSync } = await import('node:fs')
      symlinkSync(process.execPath, runtime)
      writeFileSync(path.join(home, 'npm'), '#!/bin/sh\nprintf compiled > "$HOME/compiled"\n', { mode: 0o755 })
      const shell = path.join(home, 'build.sh')
      writeFileSync(shell, `set -eu\nROOT="$1"\nRUNTIME="$2"\nfind_runtime() { echo "$RUNTIME"; }\nok() { :; }\ntell() { :; }\ndie() { echo "$*" >&2; exit 1; }\ninstall_app() { touch "$HOME/installed"; }\n${downloader}\n${builder}\nbuild_native\n`)
      const result = await promisify(execFile)('sh', [shell, checkout, runtime], { env: { ...process.env, HOME: home } })
      expect(result.stderr).toBe('') // Expected 404 fallbacks must remain quiet.
      const prebuilt = scenario.github || scenario.npm
      expect(existsSync(path.join(home, 'compiled'))).toBe(!prebuilt)
      expect(existsSync(path.join(home, 'installed'))).toBe(true)
      if (prebuilt) expect(readFileSync(path.join(checkout, '.output/server/index.mjs'), 'utf8')).toBe('// prebuilt')
      if (scenario.github) expect(requests.some(url => url.startsWith('/npm/'))).toBe(false)
      expect(readFileSync(path.join(checkout, 'skills/wherdr/SKILL.md'), 'utf8')).toBe('checkout skill for legacy npm')
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()))
      rmSync(home, { recursive: true, force: true })
    }
  })
}

it('reports npm and Homebrew blockers separately and does not rewrite an already-current latest', async () => {
  const request = async () => ({ ok: false, json: async () => ({}), text: async () => '' })
  const result = await readiness('1.3.3', request, 'example/wherdr')
  expect(result.ready).toBe(false)
  expect(result.missing.join('\n')).toMatch(/npm latest/)
  expect(result.missing.join('\n')).toMatch(/npm archive/)
  expect(result.missing.join('\n')).toMatch(/Homebrew formula.*bump-homebrew/)
  const calls: string[] = []
  const run = (_cmd: string, args: string[]) => {
    calls.push(args.join(' '))
    return JSON.stringify(args[1].endsWith('/latest') ? { tag_name: 'v1.3.3' } : [{ tag_name: 'v1.3.3' }])
  }
  const logs: string[] = []
  await promote({ repo: 'example/wherdr', request, run, log: (line: string) => logs.push(line) })
  expect(calls).toHaveLength(2)
  expect(calls.some(call => call.includes('release edit'))).toBe(false)
  expect(logs.join('\n')).toContain('already at v1.3.3')
})
