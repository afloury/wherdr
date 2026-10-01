import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { afterAll, describe, expect, it } from 'vitest'
import { proposedRepo, readOnlyMessage, tickerRunning } from '../shared/projectsActions'
import { french } from '../app/utils/i18n'
import { gitToplevel } from '../server/utils/changes'
import type { Machine } from '../server/utils/machines'

describe('"New project": suggested repository', () => {
  it('suggests the repository root under HOME, never HOME itself', () => {
    expect(proposedRepo('/home/demo/code/app', '/home/demo')).toBe('/home/demo/code/app')
    expect(proposedRepo('/home/demo/code/app/\n', '/home/demo/')).toBe('/home/demo/code/app')
    expect(proposedRepo('/home/demo', '/home/demo')).toBe('')
    expect(proposedRepo('', '/home/demo')).toBe('')
    expect(proposedRepo(null, '/home/demo')).toBe('')
    expect(proposedRepo('/srv/app', '/home/demo')).toBe('')
    expect(proposedRepo('/home/demo2/app', '/home/demo')).toBe('')
    expect(proposedRepo('relative/app', '/home/demo')).toBe('')
  })

  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'wherdr-gitroot-')))
  afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }))
  const local = {} as Machine

  it('finds the root from a subfolder of the repository (git rev-parse --show-toplevel)', async () => {
    const repo = path.join(tmp, 'repo')
    fs.mkdirSync(path.join(repo, 'src/deep'), { recursive: true })
    execFileSync('git', ['init', '-q', repo])
    expect(await gitToplevel(local, path.join(repo, 'src/deep'))).toBe(repo)
    expect(await gitToplevel(local, repo)).toBe(repo)
  })

  it('finds nothing outside a repository or for a missing folder', async () => {
    const plain = path.join(tmp, 'plain')
    fs.mkdirSync(plain)
    // A `.git` that is not a repository (old leftover, empty folder) does not count.
    fs.mkdirSync(path.join(plain, '.git'))
    expect(await gitToplevel(local, plain)).toBe('')
    expect(await gitToplevel(local, path.join(tmp, 'missing'))).toBe('')
  })
})

describe('herdr-projects en Docker : HOME en lecture seule', () => {
  const raw = 'herdr-projects: could not create /home/demo/.herdr-projects/test: Read-only file system (os error 30)'

  it('explains what to mount when wherdr runs in Docker', () => {
    const en = readOnlyMessage(raw, { docker: true })!
    expect(en).toMatch(/^wherdr runs in Docker with your home folder read-only/)
    expect(en).toContain('/home/demo/.herdr-projects/test')
    expect(en).toContain('docker-compose.yml')
    expect(french(en)).toMatch(/^wherdr tourne en Docker avec le HOME en lecture seule/)
    expect(french(en)).toContain('/home/demo/.herdr-projects/test')
  })

  it('stays plain outside Docker and without a recognizable path', () => {
    expect(readOnlyMessage(raw, { docker: false }))
      .toBe('herdr-projects cannot write to /home/demo/.herdr-projects/test: read-only file system.')
    expect(readOnlyMessage('EROFS: read-only file system', { docker: false }))
      .toBe('herdr-projects cannot write: read-only file system.')
    expect(french(readOnlyMessage('EROFS: read-only file system', { docker: true })!)).toMatch(/ne peut pas écrire\. Monte/)
  })

  it('lets other errors through', () => {
    expect(readOnlyMessage('herdr-projects: a project named `demo` already exists', { docker: true })).toBeNull()
    expect(readOnlyMessage('Permission denied (os error 13)', { docker: true })).toBeNull()
    expect(readOnlyMessage('', { docker: true })).toBeNull()
  })

  it('reads the ticker state', () => {
    expect(tickerRunning('ticker: running\n  version: 0.2.30\n  pid:     42')).toBe(true)
    expect(tickerRunning('ticker: not running (root /home/demo/.herdr-projects)')).toBe(false)
    expect(tickerRunning('')).toBe(false)
    expect(tickerRunning(null)).toBe(false)
  })
})
