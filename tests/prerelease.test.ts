// Rolling develop prerelease: scripts/prerelease.sh and .github/workflows/develop-prerelease.yml.
import { execFile, execFileSync, spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { hasCommands } from './helpers/commands'

const SCRIPT = path.resolve('scripts/prerelease.sh')
const SHA = 'a'.repeat(40)
const homes: string[] = []
afterEach(() => { for (const h of homes.splice(0)) rmSync(h, { recursive: true, force: true }) })

function workspace(version = '2.0.0-dev', pkgVersion = version) {
  const home = mkdtempSync(path.join(os.tmpdir(), 'wherdr-prerelease-'))
  homes.push(home)
  writeFileSync(path.join(home, 'CHANGELOG.md'), '# Changelog\n\n## [Unreleased]\n\n- Downloads now work reliably. Temporary links are cleaned up after each download.\n')
  writeFileSync(path.join(home, 'herdr-plugin.toml'), `id = "example.wherdr"\nversion = "${version}"\n`)
  writeFileSync(path.join(home, 'package.json'), JSON.stringify({ name: 'wherdr', version: pkgVersion }))
  return home
}

// An npm pack-like archive with what fetch_prebuilt installs.
function archive(home: string, opts: { omit?: string, extra?: Record<string, string | Buffer> } = {}) {
  const pkg = path.join(home, 'src', 'package')
  const files: Record<string, string | Buffer> = {
    '.output/server/index.mjs': '// built server',
    'bin/wherdr.mjs': '// cli',
    'bin/lib/install-skill.sh': '# skill',
    'bin/lib/verify-release.mjs': readFileSync('bin/lib/verify-release.mjs', 'utf8'),
    'package.json': readFileSync(path.join(home, 'package.json'), 'utf8'),
    'skills/wherdr/SKILL.md': 'skill',
    '.output/server/node_modules/web-push/package.json': '{"keywords":["binary"]}',
    ...opts.extra,
  }
  for (const [rel, body] of Object.entries(files)) {
    if (rel === opts.omit) continue
    mkdirSync(path.dirname(path.join(pkg, rel)), { recursive: true })
    writeFileSync(path.join(pkg, rel), body)
  }
  const out = path.join(home, 'out')
  mkdirSync(out, { recursive: true })
  const version = JSON.parse(readFileSync(path.join(home, 'package.json'), 'utf8')).version
  const tgz = path.join(out, `wherdr-${version}.tgz`)
  execFileSync('tar', ['-czf', tgz, '-C', path.join(home, 'src'), 'package'])
  return tgz
}

function run(home: string, args: string[], env: Record<string, string> = {}) {
  return spawnSync('bash', [SCRIPT, ...args], { cwd: home, encoding: 'utf8', env: { ...process.env, ...env } })
}

describe.skipIf(!hasCommands('bash'))('version', () => {
  for (const [plugin, pkg, ok] of [
    ['2.0.0-dev', '2.0.0-dev', true], ['2.1.0-rc.1', '2.1.0-rc.1', true],
    ['2.0.0', '2.0.0', false], ['1.3.4', '1.3.4', false], ['2.0.0-dev', '2.0.0', false], ['2.0.0-dev;x', '2.0.0-dev;x', false],
  ] as const) {
    it(`${plugin} / ${pkg}: ${ok ? 'published' : 'refused'}`, () => {
      const r = run(workspace(plugin, pkg), ['version'])
      expect(r.status === 0, r.stderr).toBe(ok)
      if (ok) expect(r.stdout.trim()).toBe(plugin)
    })
  }
})

describe.skipIf(!hasCommands('bash', 'tar'))('package', () => {
  it('writes the checksum verify-release.mjs accepts, COMMIT and notes with the SHA', () => {
    const home = workspace()
    const tgz = archive(home)
    const r = run(home, ['package', tgz, SHA])
    expect(r.status, r.stderr).toBe(0)
    const sum = readFileSync(`${tgz}.sha256`, 'utf8')
    expect(sum).toMatch(/^[0-9a-f]{64} {2}wherdr-2\.0\.0-dev\.tgz\n$/)
    execFileSync(process.execPath, ['bin/lib/verify-release.mjs', tgz, `${tgz}.sha256`])
    expect(readFileSync(path.join(home, 'out/COMMIT'), 'utf8')).toBe(`${SHA}\n`)
    const notes = readFileSync(path.join(home, 'out/prerelease-notes.md'), 'utf8')
    expect(notes).toContain("## Update")
    expect(notes).toContain("Downloads now work reliably.")
    expect(notes).toContain(`/blob/${SHA}/CHANGELOG.md`)
    expect(notes).toContain(SHA)
    expect(notes).toMatch(/never marked latest/)
  })

  it('refuses to package link-only prerelease notes when Unreleased has no changes', () => {
    const home = workspace()
    const tgz = archive(home)
    writeFileSync(path.join(home, 'CHANGELOG.md'), '# Changelog\n## [Unreleased]\n')
    const result = run(home, ['package', tgz, SHA])
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('Unreleased entries')
  })

  for (const [name, opts] of [
    ['no skill helper', { omit: 'bin/lib/install-skill.sh' }],
    ['no skill', { omit: 'skills/wherdr/SKILL.md' }],
    ['no server', { omit: '.output/server/index.mjs' }],
    ['a .node addon', { extra: { '.output/server/node_modules/x/build/Release/x.node': 'addon' } }],
    ['binding.gyp', { extra: { '.output/server/node_modules/x/binding.gyp': '{}' } }],
    ['prebuilds', { extra: { '.output/server/node_modules/x/prebuilds/linux-x64/x.txt': 'x' } }],
    ['an ELF binary', { extra: { '.output/server/node_modules/x/bin/tool': Buffer.from([0x7F, 0x45, 0x4C, 0x46, 2, 1]) } }],
    ['a Mach-O binary', { extra: { '.output/server/node_modules/x/tool': Buffer.from([0xCF, 0xFA, 0xED, 0xFE, 7]) } }],
  ] as const) {
    it(`refuses a package with ${name}`, () => {
      const home = workspace()
      const tgz = archive(home, opts as { omit?: string, extra?: Record<string, string | Buffer> })
      const r = run(home, ['package', tgz, SHA])
      expect(r.status).not.toBe(0)
      expect(existsSync(`${tgz}.sha256`)).toBe(false)
      expect(existsSync(path.join(home, 'out/COMMIT'))).toBe(false)
    })
  }

  it('refuses a short SHA and an archive of another version', () => {
    const home = workspace()
    const tgz = archive(home)
    expect(run(home, ['package', tgz, 'abc123']).status).not.toBe(0)
    expect(run(workspace('2.0.0-beta'), ['package', tgz, SHA]).status).not.toBe(0)
  })
})

describe.skipIf(!hasCommands('bash', 'tar'))('publish', () => {
  // A fake gh: `state` is the existing release ("" = none), `tag` whether
  // the tag exists, `assets` the names already attached.
  function publish(state: string, opts: { tag?: boolean, assets?: string[], rolling?: boolean } = {}) {
    const home = workspace(opts.rolling ? '2.1.0' : '2.0.0-dev')
    const tag = opts.rolling ? 'develop' : 'v2.0.0-dev'
    const tgz = archive(home)
    expect(run(home, ['package', tgz, SHA], { PRERELEASE_TAG: opts.rolling ? 'develop' : '' }).status).toBe(0)
    const bin = path.join(home, 'bin')
    mkdirSync(bin)
    writeFileSync(path.join(bin, 'gh'), `#!/bin/sh
case "$*" in
  'release view ${tag} --json isPrerelease,isDraft '*) [ -n "$STATE" ] || exit 1; echo "$STATE" ;;
  'release view ${tag} --json assets '*) printf '%s\\n' $ASSETS ;;
  'api repos/example/wherdr/git/refs/tags/${tag}') [ "$TAG" = 1 ] || exit 1; echo '{}' ;;
  *) printf '%s\\n' "$*" >> "$CALLS" ;;
esac
`, { mode: 0o755 })
    const calls = path.join(home, 'calls')
    const r = run(home, ['publish', tgz, SHA], {
      PATH: `${bin}:${process.env.PATH}`, GH_REPO: 'example/wherdr', CALLS: calls,
      PRERELEASE_TAG: opts.rolling ? 'develop' : '', STATE: state, TAG: opts.tag ? '1' : '0', ASSETS: (opts.assets ?? []).join(' '),
    })
    const lines = existsSync(calls) ? readFileSync(calls, 'utf8').trim().split('\n') : []
    return { r, lines, tgz }
  }

  it('creates the tag and a prerelease that is never latest, COMMIT last', () => {
    const { r, lines, tgz } = publish('')
    expect(r.status, r.stderr).toBe(0)
    expect(lines[0]).toBe(`api -X POST repos/example/wherdr/git/refs -f ref=refs/tags/v2.0.0-dev -f sha=${SHA}`)
    expect(lines[1]).toMatch(/^release create v2\.0\.0-dev --verify-tag --prerelease --latest=false /)
    expect(lines[2]).toBe(`release upload v2.0.0-dev ${tgz} ${tgz}.sha256 --clobber`)
    expect(lines[3]).toBe(`release upload v2.0.0-dev ${path.dirname(tgz)}/COMMIT --clobber`)
    expect(lines).toHaveLength(4)
  })

  it('moves the tag and replaces the files of an existing prerelease, COMMIT removed first', () => {
    const { r, lines, tgz } = publish('true false', { tag: true, assets: ['wherdr-2.0.0-dev.tgz', 'COMMIT'] })
    expect(r.status, r.stderr).toBe(0)
    expect(lines).toEqual([
      'release delete-asset v2.0.0-dev COMMIT --yes',
      `api -X PATCH repos/example/wherdr/git/refs/tags/v2.0.0-dev -f sha=${SHA} -F force=true`,
      expect.stringMatching(/^release edit v2\.0\.0-dev --prerelease --latest=false --title wherdr 2\.0\.0-dev --notes-file /),
      `release upload v2.0.0-dev ${tgz} ${tgz}.sha256 --clobber`,
      `release upload v2.0.0-dev ${path.dirname(tgz)}/COMMIT --clobber`,
    ])
  })

  for (const state of ['false false', 'true true', 'false true']) {
    it(`leaves a release that is not a published prerelease alone (${state})`, () => {
      const { r, lines } = publish(state, { tag: true })
      expect(r.status).not.toBe(0)
      expect(lines).toEqual([])
      const rolling = publish(state, { rolling: true, tag: true })
      expect(rolling.r.status).not.toBe(0)
      expect(rolling.lines).toEqual([])
    })
  }

  it('publishes stable package versions only to the fixed develop channel', () => {
    const { r, lines, tgz } = publish('', { rolling: true })
    expect(r.status, r.stderr).toBe(0)
    expect(lines[0]).toContain('ref=refs/tags/develop')
    expect(lines[1]).toMatch(/^release create develop .*--prerelease --latest=false /)
    expect(lines[2]).toBe(`release upload develop ${tgz} ${tgz}.sha256 --clobber`)
    expect(lines[3]).toContain('COMMIT --clobber')
    expect(lines.join('\n')).not.toContain('refs/tags/v2.1.0')
  })

  it('removes previous version assets before attaching COMMIT', () => {
    const { r, lines } = publish('true false', { rolling: true, tag: true, assets: ['COMMIT', 'wherdr-2.0.1.tgz', 'wherdr-2.0.1.tgz.sha256'] })
    expect(r.status, r.stderr).toBe(0)
    expect(lines[0]).toBe('release delete-asset develop COMMIT --yes')
    expect(lines.slice(-3, -1)).toEqual(['release delete-asset develop wherdr-2.0.1.tgz --yes', 'release delete-asset develop wherdr-2.0.1.tgz.sha256 --yes'])
    expect(lines.at(-1)).toContain('COMMIT --clobber')
  })

  it('refuses a stable version before calling gh', () => {
    const home = workspace('2.0.0')
    const r = run(home, ['publish', path.join(home, 'wherdr-2.0.0.tgz'), SHA], { PATH: '/nonexistent', GH_REPO: 'example/wherdr' })
    expect(r.status).not.toBe(0)
  })
})

describe('workflow', () => {
  const wf = readFileSync('.github/workflows/develop-prerelease.yml', 'utf8')

  it('runs on pushes to develop only, one at a time, never on tags', () => {
    expect(wf).toMatch(/on:\n {2}push:\n {4}branches: \[develop\]\n {2}workflow_dispatch:\n\n/)
    expect(wf).not.toMatch(/tags:/)
    expect(wf).toContain("if: github.ref == 'refs/heads/develop'")
    expect(wf).toContain('cancel-in-progress: false')
    expect(wf).toMatch(/^permissions:\n {2}contents: read\n/m)
  })

  it('checks the version, packs like release.yml, checks then publishes the commit', () => {
    const steps = ['bash scripts/prerelease.sh version', 'npm ci', 'npm pack', 'scripts/prerelease.sh package', 'scripts/prerelease.sh publish']
    const jobs = wf.slice(wf.indexOf('\njobs:'))
    const at = steps.map(s => jobs.indexOf(s))
    expect(at.every(i => i > 0)).toBe(true)
    expect([...at].sort((a, b) => a - b)).toEqual(at)
    expect(wf.match(/"\$GITHUB_SHA"/g)).toHaveLength(2)
  })

  for (const version of ['2.1.0', '2.1.0-dev']) {
    it(`packages ${version} unconditionally on the develop channel`, () => {
      const home = workspace(version)
      const tgz = archive(home)
      writeFileSync(path.join(home, 'CHANGELOG.md'), '# Changelog\n## [Unreleased]\n')
      const result = run(home, ['package', tgz, SHA], { PRERELEASE_TAG: 'develop' })
      expect(result.status, result.stderr).toBe(0)
      expect(wf).toContain('PRERELEASE_TAG: develop')
      expect(wf).not.toContain("if: steps.v.outputs.version")
      expect(wf).not.toContain('exit 0')
    })
  }

  it('keeps the repository lockfile versions aligned with its package version', () => {
    const version = JSON.parse(readFileSync('package.json', 'utf8')).version
    const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'))
    expect(lock.version).toBe(version)
    expect(lock.packages[''].version).toBe(version)
  })

  it('leaves the stable release workflows on vX.Y.Z tags', () => {
    expect(readFileSync('.github/workflows/release.yml', 'utf8')).toContain("tags: ['v*']")
    expect(readFileSync('.github/workflows/npm.yml', 'utf8')).toMatch(/\^v\[0-9\]\+\\\.\[0-9\]\+\\\.\[0-9\]\+\$/)
  })
})

it.skipIf(!hasCommands('bash', 'tar', 'curl'))('a prerelease package installs through fetch_prebuilt without compiling', async () => {
  const home = workspace()
  const tgz = archive(home)
  expect(run(home, ['package', tgz, SHA]).status).toBe(0)
  const requests: string[] = []
  const server = http.createServer((req, res) => {
    requests.push(req.url || '')
    const file = path.join(home, 'out', path.basename(req.url || ''))
    if (!req.url?.startsWith('/github/v2.0.0-dev/') || !existsSync(file)) { res.writeHead(404); res.end(); return }
    res.end(readFileSync(file))
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
    const script = readFileSync('scripts/herdr-plugin.sh', 'utf8')
    const downloader = script.slice(script.indexOf('fetch_prebuilt()'), script.indexOf('# qrcode-terminal'))
      .replace('https://github.com/$SOURCE/releases/download', `${base}/github`)
      .replaceAll('https://registry.npmjs.org', `${base}/npm`)
    const builder = script.slice(script.indexOf('build_native()'), script.indexOf('# Copies the commands'))
    const checkout = path.join(home, 'checkout')
    mkdirSync(path.join(checkout, 'bin/lib'), { recursive: true })
    cpSync('bin/lib/verify-release.mjs', path.join(checkout, 'bin/lib/verify-release.mjs'))
    cpSync(path.join(home, 'herdr-plugin.toml'), path.join(checkout, 'herdr-plugin.toml'))
    const runtime = path.join(home, 'node')
    symlinkSync(process.execPath, runtime)
    writeFileSync(path.join(home, 'npm'), '#!/bin/sh\nprintf compiled > "$HOME/compiled"\n', { mode: 0o755 })
    const shell = path.join(home, 'build.sh')
    writeFileSync(shell, `set -eu\nROOT="$1"\nRUNTIME="$2"\nfind_runtime() { echo "$RUNTIME"; }\nok() { echo "$*"; }\ntell() { :; }\ndie() { echo "$*" >&2; exit 1; }\ninstall_app() { touch "$HOME/installed"; }\n${downloader}\n${builder}\nbuild_native\n`)
    const result = await promisify(execFile)('sh', [shell, checkout, runtime], { env: { ...process.env, HOME: home } })
    expect(result.stdout).toContain('wherdr 2.0.0-dev downloaded (github package, checksum matched)')
    expect(existsSync(path.join(home, 'compiled'))).toBe(false)
    expect(existsSync(path.join(home, 'installed'))).toBe(true)
    expect(readFileSync(path.join(checkout, 'skills/wherdr/SKILL.md'), 'utf8')).toBe('skill')
    expect(existsSync(path.join(checkout, 'bin/lib/install-skill.sh'))).toBe(true)
    expect(requests.some(url => url.startsWith('/npm/'))).toBe(false)
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
})
