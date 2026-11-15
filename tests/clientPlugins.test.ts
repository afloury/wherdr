import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { parseManifest } from '../shared/clientPlugins'
import { listClientPlugins, pluginFile } from '../server/utils/clientPlugins'

describe('manifest', () => {
  it('accepts a minimal manifest and defaults main', () => {
    expect(parseManifest('demo', { name: 'Demo' })).toEqual({ id: 'demo', name: 'Demo', version: '', description: '', main: 'index.js' })
  })
  it('refuses a bad id, a path in main, or a non-js main', () => {
    expect(parseManifest('../x', {})).toBeNull()
    expect(parseManifest('demo', { main: '../index.js' })).toBeNull()
    expect(parseManifest('demo', { main: 'a.html' })).toBeNull()
    expect(parseManifest('demo', null)).toBeNull()
  })
})

describe('plugins folder', () => {
  let dir = ''
  afterEach(async () => { if (dir) await fsp.rm(dir, { recursive: true, force: true }); dir = '' })
  it('missing or empty folder: no plugin', async () => {
    expect(await listClientPlugins('/nonexistent-dir-for-test')).toEqual([])
    dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'wherdr-plugins-'))
    expect(await listClientPlugins(dir)).toEqual([])
  })
  it('lists valid plugins and skips broken ones', async () => {
    dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'wherdr-plugins-'))
    await fsp.mkdir(path.join(dir, 'good'))
    await fsp.writeFile(path.join(dir, 'good', 'manifest.json'), '{"name":"Good","version":"1.0"}')
    await fsp.mkdir(path.join(dir, 'broken'))
    await fsp.writeFile(path.join(dir, 'broken', 'manifest.json'), '{nope')
    await fsp.mkdir(path.join(dir, 'empty'))
    expect((await listClientPlugins(dir)).map(p => p.id)).toEqual(['good'])
  })
  it('only serves plain file names', () => {
    expect(pluginFile('demo', 'index.js', '/d')).toBe(path.join('/d', 'demo', 'index.js'))
    expect(pluginFile('demo', '../manifest.json', '/d')).toBeNull()
    expect(pluginFile('..', 'index.js', '/d')).toBeNull()
  })
})
