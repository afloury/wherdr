import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { inboxDoneArgs, inboxIdOk, inboxThread, parseInboxItem, parseRoutineList, routineListArgs, sortInbox, tomlStrings } from '../shared/projectInbox'
import { INBOX_MAX, inboxDoneOn, inboxOn, routinesOn } from '../server/utils/projectInbox'
import { type MachineFs, localFs } from '../server/utils/fsx'
import type { Machine } from '../server/utils/machines'
import { DemoServer } from '../app/demo/server'
import * as S from '../app/demo/scenario'

const item = (id: string, fields: string, body = '') => `+++\nid = "${id}"\n${fields}\n+++\n${body ? `\n${body}\n` : ''}`

describe('inbox item files', () => {
  it('reads the four kinds of TOML strings', () => {
    expect(tomlStrings([
      'basic = "a \\"quoted\\" word, a tab\\t and \\u00e9"',
      'literal = \'C:\\path "as is"\'',
      'multi = """',
      'first "line"',
      'second\\',
      '   joined"""',
      'raw = \'\'\'',
      'it\'s raw \\n',
      'kept\'\'\'',
      'quotes = """She said "hi""""',
      'number = 3',
      'unclosed = "oops',
      'last = "ok"',
    ].join('\n'))).toEqual({
      basic: 'a "quoted" word, a tab\t and é',
      literal: 'C:\\path "as is"',
      multi: 'first "line"\nsecondjoined',
      raw: 'it\'s raw \\n\nkept',
      quotes: 'She said "hi"',
      last: 'ok',
    })
  })

  it('parses an item, with a routine’s prompt as its body', () => {
    expect(parseInboxItem(item('20260101T101500Z-routine-nightly-41', 'kind = "routine"\nsubject = "nightly"\ncreated = "2026-01-01T10:15:00Z"\nsummary = \'Routine nightly is due\'\nevent = "due"', 'Run the suite.\n\nThen report.'))).toEqual({
      id: '20260101T101500Z-routine-nightly-41', kind: 'routine', subject: 'nightly', event: 'due',
      summary: 'Routine nightly is due', created: '2026-01-01T10:15:00Z', body: 'Run the suite.\n\nThen report.',
    })
    // No body, front matter closed at the very end of the file.
    expect(parseInboxItem('+++\nid = "20260101T000000Z-pr-t-0007-2"\nkind = "pr"\nsubject = "t-0007"\n+++')).toMatchObject({ id: '20260101T000000Z-pr-t-0007-2', subject: 't-0007', body: '' })
  })

  it('refuses what is not an item, and keeps texts on one bounded line', () => {
    for (const text of ['', 'plain text', '+++\nkind = "pr"\n+++\n', '+++\nid = "../x"\n+++\n', '+++\nid = "--all"\n+++\n', '+++\nid = "20260101-a"\n']) expect(parseInboxItem(text), text).toBeNull()
    const long = parseInboxItem(item('20260101T000000Z-a-b-1', `summary = """line one\nline two ${'x'.repeat(2000)}"""`, 'p'.repeat(5000)))!
    expect(long.summary.startsWith('line one line two x')).toBe(true)
    expect(long.summary.length).toBe(1000)
    expect(long.body.length).toBe(2001)
  })

  it('orders items oldest first and finds the thread an item is about', () => {
    const list = ['20260102T000000Z-b-1', '20260101T000000Z-a-2', '20260101T120000Z-c-3'].map(id => parseInboxItem(item(id, 'subject = "t-0012"'))!)
    expect(sortInbox(list).map(x => x.id)).toEqual(['20260101T000000Z-a-2', '20260101T120000Z-c-3', '20260102T000000Z-b-1'])
    expect(inboxThread(list[0]!)).toBe('t-0012')
    expect(inboxThread({ subject: 'nightly' })).toBeNull()
  })

  it('builds inbox done for checked IDs only, never --all', () => {
    expect(inboxDoneArgs('/srv/projects', 'demo', ['20260101T000000Z-a-b-1'])).toEqual(['--root', '/srv/projects', 'inbox', 'done', 'demo', '20260101T000000Z-a-b-1'])
    for (const id of ['', '--all', '-x', '.hidden', 'a/b', 'a..b', 'a b', 'a;b', 7]) expect(inboxIdOk(id), String(id)).toBe(false)
    expect(() => inboxDoneArgs('/r', 'demo', ['--all'])).toThrow('invalid inbox item')
    expect(() => inboxDoneArgs('/r', 'demo', [])).toThrow('invalid inbox item')
    expect(() => inboxDoneArgs('/r', '--root', ['a-1'])).toThrow('invalid project')
    expect(() => inboxDoneArgs('r', 'demo', ['a-1'])).toThrow('invalid projects root')
  })
})

describe('routine list', () => {
  it('reads the tab-separated lines and keeps the run texts as printed', () => {
    const out = [
      'nightly\tdaily 02:30\tenabled\tprompt only\tlast 2026-01-01 02:30 · next 2026-01-02 02:30 · 1 run(s) skipped while its item was unhandled',
      'pr-followup\ton pr: checks-failed, review\tenabled\tprompt only\t',
      'audit\tevery 7d\tdisabled\tcommand: NOT approved (or edited since approval)\tlast 2025-12-28 09:00 · next - (disabled)',
      'old.md\tconfig-error: missing schedule',
      'a line of another shape',
      'bad\tdaily\tmaybe\tprompt only\t',
      '',
    ].join('\n')
    expect(parseRoutineList(out)).toEqual({
      routines: [
        { name: 'nightly', schedule: 'daily 02:30', enabled: true, kind: 'prompt only', when: ['last 2026-01-01 02:30', 'next 2026-01-02 02:30', '1 run(s) skipped while its item was unhandled'] },
        { name: 'pr-followup', schedule: 'on pr: checks-failed, review', enabled: true, kind: 'prompt only', when: [] },
        { name: 'audit', schedule: 'every 7d', enabled: false, kind: 'command: NOT approved (or edited since approval)', when: ['last 2025-12-28 09:00', 'next - (disabled)'] },
      ],
      broken: [{ file: 'old.md', error: 'missing schedule' }],
    })
    expect(parseRoutineList('no routines\n')).toEqual({ routines: [], broken: [] })
    expect(routineListArgs('/srv/projects', 'demo')).toEqual(['--root', '/srv/projects', 'routine', 'list', 'demo'])
    expect(() => routineListArgs('/r', '-x')).toThrow('invalid project')
  })
})

// A stand-in for the herdr-projects binary and a project folder in a temp
// dir: no real project is read or changed.
describe('inbox and routines with a simulated herdr-projects', () => {
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'wherdr-inbox-')))
  afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }))
  const dir = path.join(tmp, 'projects/demo')
  const calls = path.join(tmp, 'calls.log')
  const bin = path.join(tmp, 'herdr-projects')
  fs.writeFileSync(bin, `#!/bin/sh
dir="$(dirname "$0")"
{ printf 'call'; for a in "$@"; do printf '\\t%s' "$a"; done; printf '\\n'; } >> "$dir/calls.log"
case "$3 $4" in
  "inbox done") [ "$6" = 20260101T000000Z-locked-1 ] && { echo "Error: the project is locked" >&2; exit 1; }
                echo "no unhandled item \\\`$6\\\`" >&2; echo "0 item(s) done" ;;
  "routine list") [ "$5" = broken ] && { echo "Error: no project broken" >&2; exit 1; }
                printf 'nightly\\tdaily 02:30\\tenabled\\tprompt only\\tlast 2026-01-01 02:30 · next 2026-01-02 02:30\\n' ;;
esac
`, { mode: 0o755 })
  const where = (slug = 'demo') => ({ m: { local: true, exec: null, session: 'default', fs: localFs } as unknown as Machine, bin, dir: path.join(tmp, 'projects', slug), slug })
  const logged = () => (fs.existsSync(calls) ? fs.readFileSync(calls, 'utf8').trim().split('\n').filter(Boolean).map(l => l.split('\t').slice(1)) : [])
  beforeEach(() => {
    fs.rmSync(calls, { force: true })
    fs.rmSync(dir, { recursive: true, force: true })
    fs.mkdirSync(path.join(dir, 'inbox/done'), { recursive: true })
  })
  const put = (name: string, text: string) => fs.writeFileSync(path.join(dir, 'inbox', name), text)

  it('lists the unhandled items of inbox/, oldest first, not the handled ones', async () => {
    put('20260102T000000Z-thread-state-t-0012-2.md', item('20260102T000000Z-thread-state-t-0012-2', 'kind = "thread-state"\nsubject = "t-0012"\nevent = "new report"'))
    put('20260101T000000Z-routine-nightly-1.md', item('20260101T000000Z-routine-nightly-1', 'kind = "routine"\nsubject = "nightly"\nevent = "due"', 'Run the suite.'))
    put('done/20251231T000000Z-pr-t-0001-0.md', item('20251231T000000Z-pr-t-0001-0', 'kind = "pr"'))
    // Not items: another file, a broken one, one whose ID is not its file name.
    put('notes.txt', 'x')
    put('20260103T000000Z-broken-3.md', 'not an item')
    put('20260104T000000Z-renamed-4.md', item('20260104T000000Z-other-9', 'kind = "pr"'))
    const r = await inboxOn(where())
    expect(r.items.map(x => [x.id, x.kind, x.event, x.body])).toEqual([
      ['20260101T000000Z-routine-nightly-1', 'routine', 'due', 'Run the suite.'],
      ['20260102T000000Z-thread-state-t-0012-2', 'thread-state', 'new report', ''],
    ])
    expect(r.total).toBe(2)
    expect(logged()).toEqual([])
  })

  it('gives an empty list without an inbox folder, and bounds a long one', async () => {
    expect(await inboxOn(where('nowhere'))).toEqual({ items: [], total: 0 })
    for (let i = 0; i < INBOX_MAX + 5; i++) {
      const id = `20260101T${String(i).padStart(6, '0')}Z-pr-t-0001-${i}`
      put(`${id}.md`, item(id, 'kind = "pr"'))
    }
    const r = await inboxOn(where())
    expect(r.items).toHaveLength(INBOX_MAX)
    expect(r.total).toBe(INBOX_MAX + 5)
    expect(r.items[0]!.id).toBe('20260101T000000Z-pr-t-0001-0')
  })

  // Found by the adversarial review (t-0315): files were read without a stat.
  it('answers at once with a named pipe in inbox/, which is not an item', async () => {
    const fifo = path.join(dir, 'inbox', '20260101T000000Z-thread-state-t-0007-1.md')
    execFileSync('mkfifo', [fifo])
    put('20260102T000000Z-pr-t-0001-2.md', item('20260102T000000Z-pr-t-0001-2', 'kind = "pr"'))
    fs.mkdirSync(path.join(dir, 'inbox', '20260103T000000Z-folder-3.md'))
    const outcome = await Promise.race([
      inboxOn(where()),
      new Promise<string>(r => setTimeout(() => r('still blocked'), 1500)),
    ])
    // Would let a blocked read go, so a failure here does not hang the run.
    fs.closeSync(fs.openSync(fifo, fs.constants.O_RDWR | fs.constants.O_NONBLOCK))
    expect(outcome).toEqual({ items: [expect.objectContaining({ id: '20260102T000000Z-pr-t-0001-2' })], total: 1 })
  })

  it('leaves the server reading other files with four named pipes in inbox/', async () => {
    const fifos = [1, 2, 3, 4].map(n => path.join(dir, 'inbox', `20260101T000000Z-thread-state-t-0007-${n}.md`))
    for (const f of fifos) execFileSync('mkfifo', [f])
    const reading = inboxOn(where())
    await new Promise(r => setTimeout(r, 300))
    const other = await Promise.race([
      fs.promises.readFile(bin).then(() => 'answered'),
      new Promise<string>(r => setTimeout(() => r('frozen'), 1500)),
    ])
    for (const f of fifos) fs.closeSync(fs.openSync(f, fs.constants.O_RDWR | fs.constants.O_NONBLOCK))
    expect(other).toBe('answered')
    expect(await reading).toEqual({ items: [], total: 0 })
  })

  it('never reads more than the size it measured, nor a file it could not measure', async () => {
    const asked: [string, number][] = []
    const id = (n: number) => `20260101T00000${n}Z-pr-t-0001-${n}`
    const fake: MachineFs = {
      ...localFs,
      readdir: async () => [1, 2, 3, 4].map(n => `${id(n)}.md`),
      statMany: async ps => ps.map((p, i) => [{ size: 60, mtimeMs: 0, isFile: true, isDir: false }, { size: 1_000_000, mtimeMs: 0, isFile: true, isDir: false }, { size: 60, mtimeMs: 0, isFile: false, isDir: false }, null][i] ?? null),
      read: async (p, _start, len) => { asked.push([path.basename(p, '.md'), len]); return Buffer.from(item(path.basename(p, '.md'), 'kind = "pr"')) },
    }
    const r = await inboxOn({ m: { fs: fake } as unknown as Machine, dir: '/srv/projects/demo' })
    expect(asked).toEqual([[id(1), 60], [id(2), 8192]])
    expect(r.items.map(x => x.id)).toEqual([id(1), id(2)])
  })

  it('marks an item as handled with inbox done, one checked ID per call', async () => {
    expect(await inboxDoneOn(where(), '20260102T000000Z-thread-state-t-0012-2')).toEqual({ ok: true })
    expect(logged()).toEqual([['--root', path.join(tmp, 'projects'), 'inbox', 'done', 'demo', '20260102T000000Z-thread-state-t-0012-2']])
    await expect(inboxDoneOn(where(), '20260101T000000Z-locked-1')).rejects.toThrow('the project is locked')
  })

  it('never runs inbox done for an invalid ID', async () => {
    for (const id of ['--all', '', 'a; rm -rf /', '../x', null, ['a-1']]) await expect(inboxDoneOn(where(), id)).rejects.toThrow('invalid inbox item')
    expect(logged()).toEqual([])
  })

  it('reads routines with routine list, and nothing else', async () => {
    expect(await routinesOn(where())).toEqual({ routines: [{ name: 'nightly', schedule: 'daily 02:30', enabled: true, kind: 'prompt only', when: ['last 2026-01-01 02:30', 'next 2026-01-02 02:30'] }], broken: [] })
    expect(logged()).toEqual([['--root', path.join(tmp, 'projects'), 'routine', 'list', 'demo']])
    await expect(routinesOn(where('broken'))).rejects.toThrow('no project broken')
  })
})

describe('demo: Inbox and Routines tabs', () => {
  it('lists items, takes a handled one off the list, and serves routines read-only', () => {
    const demo = new DemoServer({ now: () => 1_800_000_000_000, setTimeout: () => 0 })
    const pane = encodeURIComponent(S.COORD)
    const list = () => demo.handle('GET', `/api/project/inbox?pane=${pane}`).body as { items: { id: string }[], total: number }
    const first = list()
    expect(first.total).toBe(3)
    expect(demo.handle('POST', '/api/project/inbox', { pane_id: S.COORD, id: first.items[0]!.id }).status).toBe(200)
    expect(list().items.map(x => x.id)).toEqual(first.items.slice(1).map(x => x.id))
    expect(demo.handle('POST', '/api/project/inbox', { pane_id: S.COORD, id: 'unknown-1' }).status).toBe(403)
    expect((demo.handle('GET', `/api/project/routines?pane=${pane}`).body as { routines: unknown[] }).routines).toHaveLength(3)
    expect(demo.handle('POST', '/api/project/routines', { pane_id: S.COORD, name: 'nightly-tests' }).status).toBe(403)
  })
})
