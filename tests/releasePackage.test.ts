import { execFileSync, execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync, cpSync } from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { expect, it } from 'vitest'
import { driverFor, realIo } from '../bin/lib/updater.mjs'
import { ready } from '../scripts/release-ready.mjs'

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
