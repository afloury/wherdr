// WHR-295: the notes whiteboard: its store (add, edit, remove, scope, links
// inside the notes folder, no path out of it) and who writes which scope.
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { noteLinks, parseNotes, writableScopes } from '../shared/notes'
import { parseAlfredCommand } from '../shared/pm/alfredCli'
import { parseCommand } from '../shared/pm/coordinator'
import { notesStore, runNotes } from '../server/utils/notesStore'

const groups = [{ id: '*group:work', name: 'Work', machines: ['mac'] }, { id: '*group:home', name: 'Home', machines: ['', 'pi'] }]
const project = { key: 'WD', machine: '', machines: ['pi'] }
let dir: string, settingsFile: string
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'notes-'))
  settingsFile = path.join(dir, 'settings.json')
  await fs.writeFile(settingsFile, JSON.stringify({ v: 1, settings: { machineGroups: JSON.stringify(groups) } }))
})
afterEach(() => fs.rm(dir, { recursive: true, force: true }))

const run = (argv: string[], input?: string, who: Parameters<typeof runNotes>[3] = { by: 'Alfred' }) => {
  const cmd = parseAlfredCommand(['notes', ...argv])
  if ('error' in cmd || cmd.name !== 'notes') throw new Error('error' in cmd ? cmd.error : cmd.name)
  return runNotes(notesStore(path.join(dir, 'notes')), cmd.notes, input, who, settingsFile) as Promise<Record<string, any>>
}

describe('notes store', () => {
  it('adds, edits and removes a note, logs who did it, and keeps its file readable', async () => {
    const { added } = await run(['add', 'Look at the plan', '--scope', 'home'], '- [ ] Read the **[Plan](plans/x.md)**\n')
    expect(added).toMatchObject({ id: 'look-at-the-plan', scope: 'Home', body: '- [ ] Read the **[Plan](plans/x.md)**' })
    expect((await run(['add', 'Look at the plan'], 'again')).added.id).toBe('look-at-the-plan-2')
    await run(['file', 'put', 'plans/x.md'], '# Plan\n')
    expect((await run(['edit', 'look-at-the-plan', '--title', 'Plan for X', '--scope', 'all'], '')).edited).toMatchObject({ title: 'Plan for X', scope: 'all', body: added.body })
    expect(await run(['list'])).toMatchObject({ notes: [{ id: 'look-at-the-plan', title: 'Plan for X' }, { id: 'look-at-the-plan-2' }], files: ['plans/x.md'] })
    expect((await run(['show', 'plans/x.md'])).text).toBe('# Plan\n')
    await run(['remove', 'look-at-the-plan'])
    expect((await run(['list'])).notes.map((n: { id: string }) => n.id)).toEqual(['look-at-the-plan-2'])
    const log = (await fs.readFile(path.join(dir, 'notes/.log.jsonl'), 'utf8')).trim().split('\n').map(l => JSON.parse(l))
    expect(log.map(l => `${l.by} ${l.action} ${l.what}`)).toEqual(['Alfred add look-at-the-plan', 'Alfred add look-at-the-plan-2', 'Alfred file put plans/x.md', 'Alfred edit look-at-the-plan', 'Alfred remove look-at-the-plan'])
  })

  it('keeps notes short and says which links lead nowhere yet', async () => {
    await expect(run(['add', 'Long'], Array(13).fill('- line').join('\n'))).rejects.toThrow(/linked file/)
    expect(await run(['add', 'Links'], '[a](other.md) [b](plans/y.md) [c](#/board?task=WD-1) [d](https://example.com)')).toMatchObject({ missing: ['other.md', 'plans/y.md'] })
  })

  it('never reaches outside the notes folder', async () => {
    for (const p of ['../x.md', 'plans/../../x.md', '/etc/x.md', 'x.md', 'plans/.log.md', 'plans/x.txt']) expect(parseNotes(['file', 'put', p], {})).toHaveProperty('error')
    expect(noteLinks('[x](../secret.md)')).toHaveProperty('error')
    expect(noteLinks('[x](plans/../../secret.md)')).toHaveProperty('error')
    await expect(run(['add', 'Bad'], '[x](../../settings.json)')).rejects.toThrow(/never \.\./)
    await expect(run(['show', '../settings.json'])).rejects.toThrow(/No file/)
  })
})

describe('notes scope rules', () => {
  it('lets a coordinator write the tab groups its project shows in, and all only when it shows in every one', async () => {
    expect(writableScopes(project, undefined, groups)).toEqual(['*group:home'])
    expect(writableScopes(project, '*', groups)).toEqual(['all', '*group:work', '*group:home'])
    expect(writableScopes(project, '*group:work', groups)).toEqual(['*group:work'])
    expect(writableScopes(project, undefined, [])).toEqual(['all'])
    const wd = { by: 'coordinator WD', project }
    expect((await run(['add', 'Mine'], 'x', wd)).added.scope).toBe('Home')
    await expect(run(['add', 'Theirs', '--scope', 'Work'], 'x', wd)).rejects.toThrow(/Home only/)
    await expect(run(['add', 'Everyone', '--scope', 'all'], 'x', wd)).rejects.toThrow(/Home only/)
    await run(['add', 'Alfred\'s', '--scope', 'work'], 'x')
    expect((await run(['list'], undefined, wd)).notes.map((n: { id: string }) => n.id)).toEqual(['mine'])
    await expect(run(['remove', 'alfred-s'], undefined, wd)).rejects.toThrow(/No note alfred-s you may write/)
  })

  it('parses the same notes words under wherdr pm', () => {
    expect(parseCommand(['notes', 'edit', 'a-note', '--title', 'New'])).toEqual({ name: 'notes', notes: { verb: 'edit', id: 'a-note', title: 'New' } })
    expect(parseCommand(['notes', 'remove', 'a', '--scope', 'all'])).toHaveProperty('error')
  })
})

describe('notes under load and linked files', () => {
  it('keeps both notes when two agents add the same title at once', async () => {
    const store = notesStore(path.join(dir, 'notes'))
    const r = await Promise.allSettled([1, 2, 3].map(i => store.add({ title: 'Same', scope: 'all', body: `body ${i}` }, 'Alfred')))
    expect(r.map(x => x.status)).toEqual(['fulfilled', 'fulfilled', 'fulfilled'])
    expect((await store.list()).map(n => n.body).sort()).toEqual(['body 1', 'body 2', 'body 3'])
  })

  it('lets a coordinator change a linked file only when no note outside its scopes links to it', async () => {
    const wd = { by: 'coordinator WD', project }
    await run(['add', 'Work plan', '--scope', 'work'], '[Plan](plans/work.md)')
    await run(['file', 'put', 'plans/work.md'], '# Work\n')
    await expect(run(['file', 'put', 'plans/work.md'], '# Gone\n', wd)).rejects.toThrow(/outside your scopes \(work-plan\)/)
    await expect(run(['file', 'remove', 'plans/work.md'], undefined, wd)).rejects.toThrow(/outside your scopes/)
    expect((await run(['show', 'plans/work.md'])).text).toBe('# Work\n')
    expect(await run(['file', 'put', 'plans/home.md'], '# Home\n', wd)).toMatchObject({ put: 'plans/home.md' })
  })
})
