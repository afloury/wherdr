// The file browser never shows wherdr's data folder (auth.json: the lock's
// signing secret), ~/.ssh or ~/.config/herdr: neither as a path written in a
// conversation, nor in a project that contains them, nor through a symlink.
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Machine } from '../server/utils/machines'

const home = mkdtempSync(path.join(tmpdir(), 'wherdr-protected-'))
const app = path.join(home, 'wherdr')
const savedHome = process.env.HOME
process.env.DATA_DIR = path.join(app, 'data')
// The scripts resolve ~/.ssh on the machine itself, from $HOME.
process.env.HOME = home
let files: typeof import('../server/utils/files')
const m = { exec: null, home } as unknown as Machine

beforeAll(async () => {
  mkdirSync(path.join(app, 'data'), { recursive: true })
  writeFileSync(path.join(app, 'data/auth.json'), '{"secret":"s"}\n')
  writeFileSync(path.join(app, 'README.md'), '# app\n')
  mkdirSync(path.join(home, '.ssh'))
  writeFileSync(path.join(home, '.ssh/id_ed25519'), 'key\n')
  mkdirSync(path.join(home, '.config/herdr'), { recursive: true })
  writeFileSync(path.join(home, '.config/herdr/config.toml'), 'x\n')
  mkdirSync(path.join(home, '.config/other'), { recursive: true })
  writeFileSync(path.join(home, '.config/other/ok.txt'), 'ok\n')
  mkdirSync(path.join(home, 'project'))
  symlinkSync(path.join(app, 'data/auth.json'), path.join(home, 'project/auth-link.json'))
  symlinkSync(path.join(home, '.ssh'), path.join(home, 'project/keys'))
  symlinkSync('data/auth.json', path.join(app, 'secret-link'))
  files = await import('../server/utils/files')
})
afterAll(() => {
  process.env.HOME = savedHome
  rmSync(home, { recursive: true, force: true })
})

describe('protected folders in the file browser', () => {
  it('refuses auth.json and keys written in a conversation, preview and download', async () => {
    for (const p of ['~/wherdr/data/auth.json', path.join(app, 'data/auth.json'), '~/.ssh/id_ed25519', '~/.config/herdr/config.toml', '~/wherdr/data/../data/auth.json']) {
      await expect(files.readWrittenPreview(m, home, p)).rejects.toMatchObject({ code: 'protected' })
      await expect(files.readWrittenBytes(m, home, p)).rejects.toMatchObject({ code: 'protected' })
    }
    expect(await files.readWrittenPreview(m, home, '~/.config/other/ok.txt')).toMatchObject({ kind: 'text', text: 'ok\n' })
  })

  it('refuses them inside a browsed project, and through a symlink', async () => {
    // The app's own folder browsed as a project: its data folder stays hidden.
    await expect(files.readFilePreview(m, app, 'data/auth.json')).rejects.toMatchObject({ code: 'protected' })
    await expect(files.readFileBytes(m, app, 'data/auth.json')).rejects.toMatchObject({ code: 'protected' })
    expect(await files.readFilePreview(m, app, 'README.md')).toMatchObject({ kind: 'text', text: '# app\n' })
    // A symlink that stays under the root: checked once resolved, on the machine.
    await expect(files.readFilePreview(m, app, 'secret-link')).rejects.toMatchObject({ code: 'protected' })
    await expect(files.readFileBytes(m, app, 'secret-link')).rejects.toMatchObject({ code: 'protected' })
    const project = path.join(home, 'project')
    await expect(files.readWrittenPreview(m, project, 'auth-link.json')).rejects.toMatchObject({ code: 'protected' })
    await expect(files.readWrittenBytes(m, project, 'keys/id_ed25519')).rejects.toMatchObject({ code: 'protected' })
    // One that leaves the project is refused as before.
    await expect(files.readFilePreview(m, project, 'auth-link.json')).rejects.toMatchObject({ code: 'outside' })
  })
})
