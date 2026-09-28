import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { afterAll, describe, expect, it } from 'vitest'
import { proposedRepo, readOnlyMessage, tickerRunning } from '../shared/projectsActions'
import { gitToplevel } from '../server/utils/changes'
import type { Machine } from '../server/utils/machines'

describe('« New project » : dépôt proposé', () => {
  it('propose la racine du dépôt sous le HOME, jamais le HOME lui-même', () => {
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

  it('trouve la racine depuis un sous-dossier du dépôt (git rev-parse --show-toplevel)', async () => {
    const repo = path.join(tmp, 'repo')
    fs.mkdirSync(path.join(repo, 'src/deep'), { recursive: true })
    execFileSync('git', ['init', '-q', repo])
    expect(await gitToplevel(local, path.join(repo, 'src/deep'))).toBe(repo)
    expect(await gitToplevel(local, repo)).toBe(repo)
  })

  it('ne trouve rien hors d’un dépôt ou pour un dossier absent', async () => {
    const plain = path.join(tmp, 'plain')
    fs.mkdirSync(plain)
    // Un `.git` qui n'est pas un dépôt (vieux reste, dossier vide) ne compte pas.
    fs.mkdirSync(path.join(plain, '.git'))
    expect(await gitToplevel(local, plain)).toBe('')
    expect(await gitToplevel(local, path.join(tmp, 'missing'))).toBe('')
  })
})

describe('herdr-projects en Docker : HOME en lecture seule', () => {
  const raw = 'herdr-projects: could not create /home/demo/.herdr-projects/test: Read-only file system (os error 30)'

  it('explique quoi monter quand wherdr tourne en Docker', () => {
    const fr = readOnlyMessage(raw, { docker: true, lang: 'fr' })!
    expect(fr).toMatch(/^wherdr tourne en Docker avec le HOME en lecture seule/)
    expect(fr).toContain('/home/demo/.herdr-projects/test')
    expect(fr).toContain('docker-compose.yml')
    const en = readOnlyMessage(raw, { docker: true, lang: 'en' })!
    expect(en).toMatch(/^wherdr runs in Docker with your home folder read-only/)
    expect(en).toContain('/home/demo/.herdr-projects/test')
    expect(readOnlyMessage(raw, { docker: true })).toBe(en)
  })

  it('reste sobre hors Docker et sans chemin reconnaissable', () => {
    expect(readOnlyMessage(raw, { docker: false, lang: 'fr' }))
      .toBe('herdr-projects ne peut pas écrire dans /home/demo/.herdr-projects/test : système de fichiers en lecture seule.')
    expect(readOnlyMessage('EROFS: read-only file system', { docker: false, lang: 'en' }))
      .toBe('herdr-projects cannot write: read-only file system.')
  })

  it('laisse passer les autres erreurs', () => {
    expect(readOnlyMessage('herdr-projects: a project named `demo` already exists', { docker: true })).toBeNull()
    expect(readOnlyMessage('Permission denied (os error 13)', { docker: true })).toBeNull()
    expect(readOnlyMessage('', { docker: true })).toBeNull()
  })

  it('lit l’état du ticker', () => {
    expect(tickerRunning('ticker: running\n  version: 0.2.30\n  pid:     42')).toBe(true)
    expect(tickerRunning('ticker: not running (root /home/demo/.herdr-projects)')).toBe(false)
    expect(tickerRunning('')).toBe(false)
    expect(tickerRunning(null)).toBe(false)
  })
})
