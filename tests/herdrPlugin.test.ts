import { spawnSync } from 'node:child_process'
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const manifest = readFileSync(new URL('../herdr-plugin.toml', import.meta.url), 'utf8')
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }

describe('herdr-plugin.toml', () => {
  it('ships the version of the app (bump both on release)', () => {
    expect(manifest.match(/^version = "([^"]*)"$/m)?.[1]).toBe(pkg.version)
  })

  // `main` holds the next major: a v2 plugin updates from its release branch.
  it.skipIf(process.platform === 'win32')('updates from the release branch of its major, not main', () => {
    const home = mkdtempSync(path.join(os.tmpdir(), 'wherdr-update-'))
    try {
      const herdr = path.join(home, 'herdr')
      writeFileSync(herdr, '#!/bin/sh\necho "herdr $*"\n')
      chmodSync(herdr, 0o755)
      const script = path.resolve(import.meta.dirname, '..', 'scripts', 'herdr-plugin.sh')
      const out = spawnSync('sh', [script, 'update'], {
        encoding: 'utf8',
        env: { PATH: process.env.PATH, HOME: home, WHERDR_DIR: path.join(home, 'wherdr'), HERDR_BIN_PATH: herdr },
      })
      const repo = manifest.match(/^id = "([^"]*)"$/m)![1]!.replace('.', '/')
      expect(out.stdout).toContain(`herdr plugin install ${repo} --ref ${pkg.version.split('.')[0]}.x --yes`)
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })
})
