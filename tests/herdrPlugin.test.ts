import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const manifest = readFileSync(new URL('../herdr-plugin.toml', import.meta.url), 'utf8')
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }

describe('herdr-plugin.toml', () => {
  it('ships the version of the app (bump both on release)', () => {
    expect(manifest.match(/^version = "([^"]*)"$/m)?.[1]).toBe(pkg.version)
  })
})
