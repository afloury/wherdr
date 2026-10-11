import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { memoryFileOk, memoryFiles, parseMemoryIndex, parseProjectSettings } from '../shared/projectDocs'
import { memoryFileOn, memoryOn, settingsOn } from '../server/utils/projectDocs'
import { localFs } from '../server/utils/fsx'
import type { Machine } from '../server/utils/machines'
import { DemoServer } from '../app/demo/server'
import * as S from '../app/demo/scenario'

const PROJECT = `+++
name = "Demo shop"
goal = 'Ship the "v2" checkout'
coordinator_profile = "claude"
thread_agent = "codex"
max_parallel_threads = 3 # per project
nudge = false

[[repos]]
path = "/srv/code/shop"

[[repos]]
path = "/Users/demo/code/shop-web"
machine = "laptop"
+++

# Instructions

max_parallel_threads = 99
`

describe('project settings (PROJECT.md front matter)', () => {
  it('reads the keys herdr-projects set knows, with defaults for absent ones', () => {
    expect(parseProjectSettings(PROJECT)).toEqual({
      name: 'Demo shop', goal: 'Ship the "v2" checkout', coordinatorProfile: 'claude', threadProfile: 'codex',
      maxParallelThreads: 3, autoResolveDays: 7, nudge: false, mute: false,
      repos: [{ path: '/srv/code/shop', machine: '' }, { path: '/Users/demo/code/shop-web', machine: 'laptop' }],
      defaults: ['autoResolveDays', 'mute'],
    })
  })

  it('gives every default for an empty front matter, and nothing without one', () => {
    expect(parseProjectSettings('+++\n\n+++\n')).toMatchObject({
      name: '', coordinatorProfile: 'claude', threadProfile: 'claude', maxParallelThreads: 10, autoResolveDays: 7, nudge: true, mute: false, repos: [],
      defaults: ['name', 'goal', 'coordinatorProfile', 'threadProfile', 'maxParallelThreads', 'autoResolveDays', 'nudge', 'mute'],
    })
    expect(parseProjectSettings('# Instructions\n')).toBeNull()
    expect(parseProjectSettings('')).toBeNull()
  })

  it('ignores a value of the wrong type and keys of other tables', () => {
    const s = parseProjectSettings('+++\nmax_parallel_threads = "many"\nmute = yes\n\n[safety]\nyolo = true\nmute = true\n\n[[repos]]\npath = "/srv/a"\n[other]\npath = "/srv/b"\n+++\n')!
    expect(s.maxParallelThreads).toBe(10)
    expect(s.mute).toBe(false)
    expect(s.repos).toEqual([{ path: '/srv/a', machine: '' }])
    expect(JSON.stringify(s)).not.toContain('yolo')
  })
})

const INDEX = `# Memory

One line per memory file: \`- [title](memory/file.md): what it holds\`.

- [Release checklist](memory/release.md): what to check before tagging
- [Deploys](memory/deploy.md) — never from the shared folder
- [Gone](memory/gone.md): was removed
- [Outside](memory/../PROJECT.md): not a memory file
- [Elsewhere](https://example.com/x.md): a link
- [Release again](memory/release.md): duplicate
`

// Found by the adversarial review (t-0315): `^\\s*…` with the `m` flag took
// 16 s on a 32 KB front matter of blank lines, with the whole server waiting.
describe('project settings: a hostile PROJECT.md', () => {
  it('reads 32 KB of blank lines at once', () => {
    const blank = `+++\n${'\n'.repeat(32 * 1024)}name = "Demo"\n${'\n'.repeat(1024)}max_parallel_threads = 4\n\n[[repos]]\n${' \n\t\n'.repeat(2048)}path = "/srv/a"\n+++\n`
    const at = performance.now()
    const s = parseProjectSettings(blank)!
    const ms = performance.now() - at
    expect([s.name, s.maxParallelThreads, s.repos]).toEqual(['Demo', 4, [{ path: '/srv/a', machine: '' }]])
    expect(ms).toBeLessThan(500)
  })

  it('reads the same settings whatever the spaces around keys and tables', () => {
    const s = parseProjectSettings('+++\n \tname =\t"Demo"\n  mute = true   # quiet\n\n  [[ repos ]]  \n  path = "/srv/a"\n+++\n')!
    expect([s.name, s.mute, s.repos]).toEqual(['Demo', true, [{ path: '/srv/a', machine: '' }]])
  })
})

describe('project memory', () => {
  it('reads the index lines that point into memory/', () => {
    expect(parseMemoryIndex(INDEX)).toEqual([
      { name: 'release.md', title: 'Release checklist', hook: 'what to check before tagging' },
      { name: 'deploy.md', title: 'Deploys', hook: 'never from the shared folder' },
      { name: 'gone.md', title: 'Gone', hook: 'was removed' },
    ])
  })

  it('lists the index, then its files in order, then the unlisted ones', () => {
    expect(memoryFiles(INDEX, ['zeta.md', 'deploy.md', 'release.md', 'notes.txt', '.hidden.md', 'alpha.md'])).toEqual([
      { name: 'MEMORY.md', title: 'MEMORY.md', hook: '', index: true },
      { name: 'release.md', title: 'Release checklist', hook: 'what to check before tagging' },
      { name: 'deploy.md', title: 'Deploys', hook: 'never from the shared folder' },
      { name: 'gone.md', title: 'Gone', hook: 'was removed', missing: true },
      { name: 'alpha.md', title: 'alpha.md', hook: '' },
      { name: 'zeta.md', title: 'zeta.md', hook: '' },
    ])
    expect(memoryFiles(null, ['a.md'])).toEqual([{ name: 'a.md', title: 'a.md', hook: '' }])
    expect(memoryFiles(null, [])).toEqual([])
  })

  it('accepts plain .md names only', () => {
    for (const ok of ['release.md', 'a-b_c.1.md']) expect(memoryFileOk(ok)).toBe(true)
    for (const bad of ['', '../PROJECT.md', 'a/b.md', '.hidden.md', 'notes.txt', 'a..md', '-x.md', 'a b.md', 'MEMORY', 7, null]) expect(memoryFileOk(bad), String(bad)).toBe(false)
  })
})

// A project folder in a temp dir: no real project is read.
describe('settings and memory read from a project folder', () => {
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'wherdr-docs-')))
  afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }))
  const dir = path.join(tmp, 'demo')
  fs.mkdirSync(path.join(dir, 'memory/sub'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'PROJECT.md'), PROJECT)
  fs.writeFileSync(path.join(dir, 'MEMORY.md'), INDEX)
  fs.writeFileSync(path.join(dir, 'memory/release.md'), '# Release checklist\n\n1. Tests green.\n')
  fs.writeFileSync(path.join(dir, 'memory/deploy.md'), '# Deploys\n')
  fs.writeFileSync(path.join(dir, 'memory/sub/deep.md'), 'deep')
  fs.writeFileSync(path.join(tmp, 'secret.md'), 'outside the project')
  const where = (d = dir) => ({ m: { local: true, fs: localFs } as unknown as Machine, dir: d })
  const snapshot = () => fs.readdirSync(dir, { recursive: true }).map(String).sort().join('\n')

  it('reads the settings, and fails without a PROJECT.md', async () => {
    expect((await settingsOn(where())).settings).toMatchObject({ name: 'Demo shop', maxParallelThreads: 3, threadProfile: 'codex' })
    await expect(settingsOn(where(path.join(tmp, 'nowhere')))).rejects.toThrow('project settings not found')
  })

  it('lists the memory files and reads one, the index included', async () => {
    const { files } = await memoryOn(where())
    expect(files.map(f => [f.name, Boolean(f.missing)])).toEqual([['MEMORY.md', false], ['release.md', false], ['deploy.md', false], ['gone.md', true]])
    expect(await memoryFileOn(where(), 'release.md')).toEqual({ name: 'release.md', text: '# Release checklist\n\n1. Tests green.\n', truncated: false })
    expect((await memoryFileOn(where(), 'MEMORY.md')).text).toContain('One line per memory file')
    expect(await memoryOn(where(path.join(tmp, 'nowhere')))).toEqual({ files: [] })
  })

  it('reads nothing outside memory/, and writes nothing', async () => {
    const before = snapshot()
    for (const name of ['../PROJECT.md', '../../secret.md', 'sub/deep.md', '/etc/hostname', '', null, ['release.md']]) await expect(memoryFileOn(where(), name), String(name)).rejects.toThrow('invalid memory file')
    await expect(memoryFileOn(where(), 'gone.md')).rejects.toThrow('memory file not found')
    // A plain name is only ever looked up in memory/: this is not the project's PROJECT.md.
    await expect(memoryFileOn(where(), 'PROJECT.md')).rejects.toThrow('memory file not found')
    // A folder named like a file is not a file.
    fs.mkdirSync(path.join(dir, 'memory/folder.md'))
    await expect(memoryFileOn(where(), 'folder.md')).rejects.toThrow('memory file not found')
    fs.rmdirSync(path.join(dir, 'memory/folder.md'))
    expect(snapshot()).toBe(before)
  })
})

describe('demo: Settings and Memory tabs', () => {
  it('serves settings and memory read-only', () => {
    const demo = new DemoServer({ now: () => 1_800_000_000_000, setTimeout: () => 0 })
    const pane = encodeURIComponent(S.COORD)
    expect((demo.handle('GET', `/api/project/settings?pane=${pane}`).body as { settings: { name: string } }).settings.name).toBe('Acme API')
    const files = (demo.handle('GET', `/api/project/memory?pane=${pane}`).body as { files: { name: string }[] }).files
    expect(files.map(f => f.name)).toEqual(['MEMORY.md', 'release.md', 'rate-limits.md'])
    expect((demo.handle('GET', `/api/project/memory?pane=${pane}&name=release.md`).body as { text: string }).text).toContain('Release checklist')
    expect(demo.handle('GET', `/api/project/memory?pane=${pane}&name=constructor`).status).toBe(404)
    expect(demo.handle('POST', '/api/project/settings', { pane_id: S.COORD, key: 'mute', value: 'true' }).status).toBe(403)
    expect(demo.handle('POST', '/api/project/memory', { pane_id: S.COORD, name: 'release.md', text: 'x' }).status).toBe(403)
  })
})
