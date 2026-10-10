import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { cleanRelative, listFiles, readFilePreview } from '../server/utils/files'
import type { Machine } from '../server/utils/machines'

const local = { exec: null } as unknown as Machine
let base = ''
let root = ''

beforeAll(() => {
  base = mkdtempSync(path.join(tmpdir(), 'wherdr-files-'))
  root = path.join(base, 'project')
  mkdirSync(path.join(root, 'src', 'deep'), { recursive: true })
  execFileSync('git', ['init', '-q', root])
  writeFileSync(path.join(root, 'README.md'), '# Hello\n')
  writeFileSync(path.join(root, '.env.example'), 'KEY=\n')
  writeFileSync(path.join(root, 'with space.txt'), 'a b\n')
  writeFileSync(path.join(root, 'src', 'app.ts'), 'export const x = 1\n')
  writeFileSync(path.join(root, 'blob.bin'), Buffer.from([1, 0, 2, 3]))
  writeFileSync(path.join(root, 'dot.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]))
  writeFileSync(path.join(root, 'big.txt'), 'line\n'.repeat(60000))
  writeFileSync(path.join(base, 'secret.txt'), 'nope\n')
  symlinkSync(path.join(base, 'secret.txt'), path.join(root, 'escape.txt'))
  symlinkSync(base, path.join(root, 'escape-dir'))
  symlinkSync(path.join(root, 'README.md'), path.join(root, 'inside.md'))
  symlinkSync(path.join(root, 'README.md'), path.join(root, '-e'))
  writeFileSync(path.join(root, 'min.js'), 'x'.repeat(300 * 1024))
  writeFileSync(path.join(root, 'accents.txt'), 'é'.repeat(200 * 1024))
  symlinkSync(root, path.join(base, 'via-link'))
  mkdirSync(path.join(base, 'crowded'))
  for (let i = 0; i < 30; i++) writeFileSync(path.join(base, 'crowded', `f${i}`), '')
  for (let i = 0; i < 3; i++) mkdirSync(path.join(base, 'crowded', `zdir${i}`))
})
afterAll(() => rmSync(base, { recursive: true, force: true }))

describe('read-only file browser', () => {
  it('lists folders first, then files with sizes, dotfiles and spaces included', async () => {
    const l = await listFiles(local, root, null)
    expect(l.path).toBe('')
    expect(l.entries.slice(0, 3).map(e => [e.name, e.kind, e.link])).toEqual([['.git', 'dir', false], ['escape-dir', 'dir', true], ['src', 'dir', false]])
    expect(l.entries.find(e => e.name === 'README.md')).toMatchObject({ kind: 'file', size: 8, link: false })
    expect(l.entries.map(e => e.name)).toEqual(expect.arrayContaining(['.env.example', '.git', 'with space.txt']))
  })

  it('starts in the pane folder and walks into subfolders', async () => {
    expect((await listFiles(local, path.join(root, 'src'), null)).entries.map(e => e.name)).toEqual(['deep', 'app.ts'])
    expect((await listFiles(local, root, 'src/deep')).entries).toEqual([])
  })

  it('refuses paths outside the root, through .. or a symlink', async () => {
    expect(() => cleanRelative('../x')).toThrow()
    expect(() => cleanRelative('/etc/passwd')).toThrow()
    expect(cleanRelative('src/./deep/')).toBe('src/deep')
    await expect(listFiles(local, root, 'escape-dir')).rejects.toMatchObject({ code: 'outside' })
    await expect(readFilePreview(local, root, 'escape.txt')).rejects.toMatchObject({ code: 'outside' })
    await expect(readFilePreview(local, root, 'missing.txt')).rejects.toMatchObject({ code: 'not_found' })
    await expect(readFilePreview(local, root, 'src')).rejects.toMatchObject({ code: 'not_file' })
  })

  it('previews text, images and binaries, truncating large text', async () => {
    expect(await readFilePreview(local, root, 'inside.md')).toMatchObject({ kind: 'text', text: '# Hello\n', truncated: false })
    expect(await readFilePreview(local, root, 'src/app.ts')).toMatchObject({ kind: 'text', size: 19 })
    expect(await readFilePreview(local, root, 'blob.bin')).toMatchObject({ kind: 'binary', size: 4 })
    expect((await readFilePreview(local, root, 'dot.png')).dataUrl).toBe('data:image/png;base64,iVBORw==')
    const big = await readFilePreview(local, root, 'big.txt')
    expect(big).toMatchObject({ kind: 'text', size: 300000, truncated: true })
    expect(big.text!.endsWith('line\n')).toBe(true)
    expect(big.text!.length).toBeLessThanOrEqual(256 * 1024)
  })

  it('hides the size of a symlink, which may point outside the root', async () => {
    const l = await listFiles(local, root, null)
    expect(l.entries.find(e => e.name === 'escape.txt')).toMatchObject({ kind: 'file', size: null, link: true })
  })

  it('opens on the pane folder even when its path goes through a symlink', async () => {
    const l = await listFiles(local, path.join(base, 'via-link', 'src'), null)
    expect(l.path).toBe('src')
    expect(l.entries.map(e => e.name)).toEqual(['deep', 'app.ts'])
  })

  it('keeps the folders when a long listing is cut', async () => {
    const l = await listFiles(local, path.join(base, 'crowded'), null, { max: 10 })
    expect(l.truncated).toBe(true)
    expect(l.entries).toHaveLength(10)
    expect(l.entries.slice(0, 3).map(e => e.name)).toEqual(['zdir0', 'zdir1', 'zdir2'])
  })

  it('previews a symlink whose name starts with a dash', async () => {
    expect(await readFilePreview(local, root, '-e')).toMatchObject({ kind: 'text', text: '# Hello\n' })
  })

  it('cuts a long single-line file at the limit without splitting a character', async () => {
    const min = await readFilePreview(local, root, 'min.js')
    expect(min).toMatchObject({ kind: 'text', truncated: true })
    expect(min.text!.length).toBe(256 * 1024)
    const acc = await readFilePreview(local, root, 'accents.txt')
    expect(acc.text!.length).toBe(128 * 1024)
    expect(acc.text!.includes('\uFFFD')).toBe(false)
  })

  it('reports a timeout and an unreachable machine as such', async () => {

    const ok = { code: 0, stdout: Buffer.from('/srv/repo\n'), stderr: '' }
    const after = (c: number | null) => {
      let n = 0
      return { exec: async () => (n++ ? { code: c, stdout: Buffer.alloc(0), stderr: '' } : ok) } as unknown as Machine
    }

    await expect(listFiles(after(124), '/srv/repo', '')).rejects.toMatchObject({ code: 'timeout' })
    await expect(listFiles(after(255), '/srv/repo', '')).rejects.toMatchObject({ code: 'unreachable' })
  })

  it('passes paths to a remote machine only as positional arguments', async () => {
    const calls: { script: string, args: string[] }[] = []
    const name = 'a;$(touch x).ts'
    const exec: NonNullable<Machine['exec']> = async (script, args = []) => {
      calls.push({ script, args })
      const out = script.includes('rev-parse') ? '/srv/repo\n' : `12\nhello`
      return { code: 0, stdout: Buffer.from(out), stderr: '' }
    }
    expect(await readFilePreview({ exec } as Machine, '/srv/repo', name)).toMatchObject({ kind: 'text', text: 'hello', size: 12 })
    expect(calls.every(c => !c.script.includes(name) && !c.script.includes('/srv/repo'))).toBe(true)
    expect(calls.at(-1)!.args.slice(0, 2)).toEqual(['/srv/repo', name])
  })
})
