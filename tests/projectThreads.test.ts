import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { CONFIRMED_ACTIONS, filterThreads, groupThreads, isThreadAction, lastLine, normalizeThreadDetail, projectSlugOk, threadActionsFor, threadCommandArgs } from '../shared/projectThreads'
import { normalizeThreads, splitThreads } from '../shared/projectBoard'
import { threadActionOn, threadDetailOn } from '../server/utils/projectThreads'
import { runProjectCommand } from '../server/utils/projectBoard'
import type { Machine } from '../server/utils/machines'
import { DemoServer } from '../app/demo/server'
import * as S from '../app/demo/scenario'

const raw = (id: string, over: Record<string, unknown> = {}) => ({
  id, title: `Thread ${id}`, status: 'open', group: 'Working', group_token: 'working', rank: 4,
  agent: 'claude', profile: 'claude', agent_name: `hp-demo-${id}`, machine: '', pane_id: 'w3:p1',
  kind: 'worktree', branch: `hp/demo/${id}-thing`, base: 'origin/main', state_line: 'working · ~40%', note: 'working',
  created: '2026-09-26T09:00:00Z', updated: '2026-09-26T10:00:00Z', percent: 40, activity: 'Writing tests',
  report: null, report_hash: '', acked_report_hash: '', next: [], error: '', pr: '', pr_state: '', pr_review: '',
  kept_worktree: false, resolved_reason: '', ...over,
})

describe('thread command arguments', () => {
  it('builds one argument per value, with --json only for show', () => {
    expect(threadCommandArgs('show', '/srv/projects', 'demo', 't-0007')).toEqual(['--root', '/srv/projects', 'thread', 'show', 'demo', 't-0007', '--json'])
    expect(threadCommandArgs('resolve', '/srv/projects', 'demo', 't-0007')).toEqual(['--root', '/srv/projects', 'thread', 'resolve', 'demo', 't-0007'])
    for (const a of ['stop', 'restart', 'ack'] as const) expect(threadCommandArgs(a, '/r', 'my.app_2', 't-12345').slice(2)).toEqual(['thread', a, 'my.app_2', 't-12345'])
  })

  it('refuses identifiers that could be read as an option, a path or another command', () => {
    for (const id of ['', 't-7', 't-0007 --discard-uncopied', '--help', '../t-0007', 'T-0007', 't-0007\n']) expect(() => threadCommandArgs('ack', '/r', 'demo', id), id).toThrow('invalid thread')
    for (const slug of ['', '-x', '--root', 'a/b', '..', 'a..b', 'a b', '.hidden']) expect(() => threadCommandArgs('ack', '/r', slug, 't-0007'), slug).toThrow('invalid project')
    expect(() => threadCommandArgs('ack', 'relative', 'demo', 't-0007')).toThrow('invalid projects root')
    expect(() => threadCommandArgs('prompt' as never, '/r', 'demo', 't-0007')).toThrow('invalid action')
    expect(projectSlugOk('acme-api')).toBe(true)
  })

  it('knows the four actions, and which ones ask first', () => {
    expect(['stop', 'restart', 'ack', 'resolve'].every(isThreadAction)).toBe(true)
    for (const a of ['prompt', 'keys', 'start', 'show', '', null, 3]) expect(isThreadAction(a)).toBe(false)
    expect([...CONFIRMED_ACTIONS].sort()).toEqual(['resolve', 'stop'])
  })
})

describe('thread record', () => {
  it('normalizes thread show --json', () => {
    const d = normalizeThreadDetail(raw('t-0007', {
      group: 'Ready for review', group_token: 'ready-for-review', rank: 2, report: '## Report', report_hash: 'abc', acked_report_hash: '',
      next: ['Merge the PR', '  ', 7, 'Remove the worktree'], pr: 'https://example.com/pr/1', pr_state: 'open', machine: 'Laptop', profile: 'codex', agent: 'codex',
    }))!
    expect(d).toMatchObject({
      id: 't-0007', token: 'ready-for-review', machine: 'Laptop', profile: 'codex', stateLine: 'working · ~40%', kind: 'worktree',
      branch: 'hp/demo/t-0007-thing', base: 'origin/main', prState: 'open', acked: false, hasPane: true, report: true,
    })
    expect(d.next).toEqual(['Merge the PR', 'Remove the worktree'])
    expect(normalizeThreadDetail(raw('t-0007', { report_hash: 'abc', acked_report_hash: 'abc' }))!.acked).toBe(true)
    expect(normalizeThreadDetail(raw('t-0007'))!.acked).toBe(false)
    expect(normalizeThreadDetail({ id: '../x' })).toBeNull()
    expect(normalizeThreadDetail(null)).toBeNull()
  })

  it('offers only the actions that can apply', () => {
    const of = (over: Record<string, unknown>) => threadActionsFor(normalizeThreadDetail(raw('t-0007', over))!)
    expect(of({})).toEqual(['stop', 'resolve'])
    expect(of({ pane_id: '' })).toEqual(['resolve'])
    expect(of({ group_token: 'ready-for-review', report: 'x', report_hash: 'h' })).toEqual(['ack', 'restart', 'resolve'])
    expect(of({ group_token: 'ready-for-review', report: 'x', report_hash: 'h', acked_report_hash: 'h' })).toEqual(['restart', 'resolve'])
    expect(of({ group_token: 'waiting-on-you', pane_id: '' })).toEqual(['restart', 'resolve'])
    expect(of({ status: 'resolved', group_token: 'resolved', report: 'x', report_hash: 'h' })).toEqual([])
  })
})

describe('Threads tab lists', () => {
  const list = normalizeThreads([
    raw('t-0001', { status: 'resolved', group: 'Resolved', group_token: 'resolved', rank: 6, title: 'Écran d’accueil', machine: 'Laptop' }),
    raw('t-0010', { title: 'Export CSV', profile: 'codex' }),
    raw('t-0011', { group: 'Ready for review', group_token: 'ready-for-review', rank: 2 }),
    raw('t-0012'),
    raw('t-0013', { group: 'Waiting on you', group_token: 'waiting-on-you', rank: 1 }),
  ])
  const { open, resolved } = splitThreads(list)

  it('groups open threads in herdr-projects order, resolved ones apart', () => {
    expect(groupThreads(open).map(g => [g.token, g.threads.map(t => t.id)])).toEqual([
      ['waiting-on-you', ['t-0013']], ['ready-for-review', ['t-0011']], ['working', ['t-0012', 't-0010']],
    ])
    expect(resolved.map(t => t.id)).toEqual(['t-0001'])
    expect(groupThreads([])).toEqual([])
  })

  it('filters on ID, title, machine and profile, every word, accents ignored', () => {
    expect(filterThreads(open, '').length).toBe(4)
    expect(filterThreads(open, '  0012 ').map(t => t.id)).toEqual(['t-0012'])
    expect(filterThreads(open, 'csv CODEX').map(t => t.id)).toEqual(['t-0010'])
    expect(filterThreads(open, 'csv claude')).toEqual([])
    expect(filterThreads(resolved, 'ecran laptop').map(t => t.id)).toEqual(['t-0001'])
  })

  it('keeps the last line of an output', () => {
    expect(lastLine('t-0007 resolved; its report and library are kept.\n  - worktree removed\n\n')).toBe('- worktree removed')
    expect(lastLine('Error: t-0007 has no pane')).toBe('t-0007 has no pane')
    expect(lastLine('')).toBe('')
  })
})

// A stand-in for the herdr-projects binary: it records its arguments and its
// Herdr session, and answers like the real commands. No real thread is touched.
describe('thread commands with a simulated herdr-projects', () => {
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'wherdr-threads-')))
  afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }))
  const calls = path.join(tmp, 'calls.log')
  const bin = path.join(tmp, 'herdr-projects')
  fs.writeFileSync(path.join(tmp, 'record.json'), JSON.stringify(raw('t-0007', { next: ['Merge the PR'], report: 'x', report_hash: 'h' })))
  fs.writeFileSync(bin, `#!/bin/sh
dir="$(dirname "$0")"
{ printf 'session=%s' "$HERDR_SESSION"; for a in "$@"; do printf '\\t%s' "$a"; done; printf '\\n'; } >> "$dir/calls.log"
cmd="$4"; id="$6"
case "$cmd" in
  show) [ "$id" = t-0404 ] && { echo "Error: no thread t-0404 in demo" >&2; exit 1; }
        [ "$id" = t-0500 ] && { echo "not json"; exit 0; }
        cat "$dir/record.json" ;;
  ack) echo "$id: report acknowledged" ;;
  stop) printf '\\033[32msent Escape to %s (pane w3:p1)\\033[0m\\n' "$id" ;;
  restart) echo "warning: slow" >&2; echo "Error: $id is running; nothing to restart" >&2; exit 1 ;;
  resolve) echo "$id resolved; its report and library are kept."; echo "  - worktree removed" ;;
esac
`, { mode: 0o755 })
  const where = (session = 'default') => ({ m: { local: true, exec: null, session } as unknown as Machine, bin, dir: '/srv/projects/demo', slug: 'demo' })
  const logged = () => (fs.existsSync(calls) ? fs.readFileSync(calls, 'utf8').trim().split('\n').filter(Boolean).map(l => l.split('\t')) : [])
  beforeEach(() => fs.rmSync(calls, { force: true }))

  it('reads a thread record with thread show --json', async () => {
    const d = await threadDetailOn(where(), 't-0007')
    expect(d).toMatchObject({ id: 't-0007', next: ['Merge the PR'], acked: false, branch: 'hp/demo/t-0007-thing' })
    expect(logged()).toEqual([['session=', '--root', '/srv/projects', 'thread', 'show', 'demo', 't-0007', '--json']])
  })

  it('reports an unknown thread or an unreadable record as an error', async () => {
    await expect(threadDetailOn(where(), 't-0404')).rejects.toThrow('no thread t-0404 in demo')
    await expect(threadDetailOn(where(), 't-0500')).rejects.toThrow('unreadable thread record')
    // A record for another thread than the one asked for is not shown.
    await expect(threadDetailOn(where(), 't-0008')).rejects.toThrow('unreadable thread record')
  })

  it('runs each action as its own command, in the machine’s Herdr session', async () => {
    expect(await threadActionOn(where('hwtest'), 't-0007', 'ack')).toEqual({ output: 't-0007: report acknowledged' })
    expect(await threadActionOn(where('hwtest'), 't-0007', 'stop')).toEqual({ output: 'sent Escape to t-0007 (pane w3:p1)' })
    expect((await threadActionOn(where(), 't-0007', 'resolve')).output).toBe('t-0007 resolved; its report and library are kept.\n  - worktree removed')
    expect(logged()).toEqual([
      ['session=hwtest', '--root', '/srv/projects', 'thread', 'ack', 'demo', 't-0007'],
      ['session=hwtest', '--root', '/srv/projects', 'thread', 'stop', 'demo', 't-0007'],
      ['session=', '--root', '/srv/projects', 'thread', 'resolve', 'demo', 't-0007'],
    ])
  })

  it('gives herdr-projects’ own refusal', async () => {
    await expect(threadActionOn(where(), 't-0007', 'restart')).rejects.toThrow('t-0007 is running; nothing to restart')
  })

  // Found by the adversarial review (t-0315): two resolve ran side by side.
  it('runs one action at a time per thread, and refuses the second one', async () => {
    const slow = path.join(tmp, 'slow')
    fs.mkdirSync(slow)
    const slowBin = path.join(slow, 'herdr-projects')
    fs.writeFileSync(slowBin, `#!/bin/sh\ndir="$(dirname "$0")"\necho "start $4 $6" >> "$dir/calls.log"\nsleep 0.4\necho "end $4 $6" >> "$dir/calls.log"\n[ "$4" = restart ] && { echo "Error: $6 is running" >&2; exit 1; }\necho "$6 resolved"\n`, { mode: 0o755 })
    const t = { ...where(), bin: slowBin }
    const log = () => fs.readFileSync(path.join(slow, 'calls.log'), 'utf8').trim().split('\n')
    const both = await Promise.allSettled([threadActionOn(t, 't-0007', 'resolve'), threadActionOn(t, 't-0007', 'resolve'), threadActionOn(t, 't-0007', 'ack')])
    expect(both.map(r => (r.status === 'fulfilled' ? r.value.output : (r.reason as Error).message))).toEqual([
      't-0007 resolved', 'an action is already running on this thread', 'an action is already running on this thread',
    ])
    expect(log()).toEqual(['start resolve t-0007', 'end resolve t-0007'])
    // Another thread, another project and another machine are not held back.
    await Promise.all([threadActionOn(t, 't-0008', 'ack'), threadActionOn(t, 't-0009', 'ack'), threadActionOn({ ...t, dir: '/srv/projects/other' }, 't-0008', 'ack'), threadActionOn({ ...t, m: { ...t.m, key: 'ab12cd34' } as Machine }, 't-0008', 'ack')])
    expect(log().filter(l => l.startsWith('start')).length).toBe(5)
    // The thread is free again once its action ended, failed or not.
    await expect(threadActionOn(t, 't-0007', 'restart')).rejects.toThrow('t-0007 is running')
    expect((await threadActionOn(t, 't-0007', 'ack')).output).toBe('t-0007 resolved')
    // An invalid request never takes the lock.
    await expect(threadActionOn(t, 'nope', 'ack')).rejects.toThrow('invalid thread')
  })

  it('never runs a command for an invalid thread or project', async () => {
    await expect(threadActionOn(where(), 't-0007; rm -rf /', 'ack')).rejects.toThrow('invalid thread')
    await expect(threadDetailOn({ ...where(), slug: '--root' }, 't-0007')).rejects.toThrow('invalid project')
    expect(logged()).toEqual([])
  })

  it('passes a remote machine the same arguments, as positional parameters', async () => {
    const seen: { script: string, args: string[] }[] = []
    const m = { local: false, session: 'work', bin: '/opt/herdr', exec: async (script: string, args: string[] = []) => {
      seen.push({ script, args })
      return { code: 0, stdout: Buffer.from('ok\n'), stderr: '' }
    } } as unknown as Machine
    expect(await runProjectCommand({ m, bin: '/plug/herdr-projects' }, ['--root', '/r', 'thread', 'ack', 'demo', 't-0007'])).toEqual({ code: 0, stdout: 'ok\n', stderr: '' })
    expect(seen[0]!.args).toEqual(['/opt/herdr', 'work', '/plug/herdr-projects', '--root', '/r', 'thread', 'ack', 'demo', 't-0007'])
    // The script itself holds no value: only "$@".
    expect(seen[0]!.script).not.toMatch(/demo|t-0007|\/r\b/)
  })
})

describe('demo: Threads tab', () => {
  const clock = { now: () => 1_800_000_000_000, setTimeout: () => 0 }
  it('serves a thread record and only lets a report be acknowledged', async () => {
    const demo = new DemoServer(clock)
    const get = (id: string) => demo.handle('GET', `/api/project/thread?pane=${encodeURIComponent(S.COORD)}&id=${id}`, {})
    const first = await get('t-0010')
    expect(first.status).toBe(200)
    expect((first.body as { thread: { id: string, resolved: boolean } }).thread).toMatchObject({ id: 't-0010', resolved: true })
    expect((await get('t-9999')).status).toBe(404)
    const post = (action: string) => demo.handle('POST', '/api/project/thread', { pane_id: S.COORD, id: 't-0012', action })
    expect((await post('resolve')).status).toBe(403)
    expect((await post('stop')).status).toBe(403)
    expect((await post('ack')).status).toBe(200)
    expect(((await get('t-0012')).body as { thread: { acked: boolean } }).thread.acked).toBe(true)
  })
})
