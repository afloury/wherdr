import { chmodSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { hasCommands } from './helpers/commands'

let bin: string | undefined
afterEach(() => {
  vi.unstubAllEnvs()
  if (bin) rmSync(bin, { recursive: true, force: true })
  bin = undefined
})

it('detects optional tools in a minimal PATH without executing them', () => {
  bin = mkdtempSync(path.join(os.tmpdir(), 'wherdr-commands-'))
  symlinkSync('/bin/sh', path.join(bin, 'sh'))
  // A capability probe must not run a tool that could modify the host.
  writeFileSync(path.join(bin, 'fixture-tool'), '#!/bin/sh\nexit 42\n')
  chmodSync(path.join(bin, 'fixture-tool'), 0o755)
  vi.stubEnv('PATH', bin)
  expect(hasCommands('fixture-tool')).toBe(true)
  expect(hasCommands('fixture-tool', 'python3')).toBe(false)
  expect(hasCommands('curl', 'sha256sum')).toBe(false)
  expect(hasCommands('fixture-tool; exit 0')).toBe(false)
})

it('reports unavailable commands when even the shell is absent', () => {
  bin = mkdtempSync(path.join(os.tmpdir(), 'wherdr-commands-'))
  vi.stubEnv('PATH', bin)
  expect(hasCommands('python3')).toBe(false)
})
