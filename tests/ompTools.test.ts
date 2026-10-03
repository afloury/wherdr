// omp's tool calls shown the way omp's terminal shows them (t-0184): fixture
// shaped like a real omp session (bash, background job, read with a line
// range, grep, edit with its diff, errors, wait), with neutral paths.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseLines } from '../server/utils/transcripts'
import { ompPath, ompToolCall } from '../server/utils/ompTools'
import { ompEarlier, ompToolGlyph, ompToolMeta, ompWall } from '../app/utils/ompTool'

const HOME = '/home/user'
const text = readFileSync(new URL('./fixtures/omp-tools.jsonl', import.meta.url), 'utf8')
const tools = parseLines(text, 'omp', 0, HOME).filter(i => i.role === 'tool')
const byTarget = (s: string) => tools.find(t => t.omp?.target?.includes(s))!

describe('omp tools', () => {
  it('keeps the summary used elsewhere (intent) and adds omp\'s own view', () => {
    expect(tools.map(t => `${t.name} ${t.text}`)).toEqual([
      'Bash Checking thread states', 'Bash Merging t-0001 alone', 'Read Reading tasks', 'Grep Finding omp activity',
      'Edit Updating TASKS.md', 'Read Getting tag', 'wait Waiting for t-0001 merge', 'Bash Running tests',
      'WebSearch Searching official logo', 'Glob Listing notes',
    ])
    expect(tools.map(t => t.omp!.title)).toEqual(['Bash', 'Bash', 'Read', 'Grep', 'Edit', 'Read', 'Wait', 'Bash', 'Web Search', 'Glob'])
  })

  it('bash: the command, its wall time and the last 10 lines of output', () => {
    const t = byTarget('threads.sh')
    expect(t.omp).toMatchObject({ target: 'tools/threads.sh list | grep -v Resolved', intent: 'Checking thread states', ms: 712, outLines: 25 })
    expect(t.omp!.out!.split('\n')).toEqual(Array.from({ length: 10 }, (_, i) => `line ${i + 16}`))
    expect(t.error).toBeUndefined()
  })

  it('bash in the background: the job id, no output nor time', () => {
    const t = byTarget('merge.sh')
    expect(t.omp).toMatchObject({ job: 'bg_2' })
    expect(t.omp!.ms).toBeUndefined()
    expect(t.omp!.out).toBeUndefined()
  })

  it('bash in error: marked, with the end of its output', () => {
    const t = byTarget('vitest')
    expect(t.error).toBe(true)
    expect(t.omp).toMatchObject({ target: 'npx vitest run\n  --reporter dot', ms: 9876, exit: 1, outLines: 2 })
    // omp's own notes ("Wall time", "Command exited") go to the footer, not the output.
    expect(t.omp!.out).toBe('FAIL tests/a.test.ts\nexpected 1 to be 2')
  })

  it('paths relative to the session folder, else under ~; line ranges kept', () => {
    expect(byTarget('TASKS.md:5-20').omp).toMatchObject({ title: 'Read', target: 'TASKS.md:5-20', ms: 30 })
    expect(byTarget('other').omp).toMatchObject({ title: 'Glob', target: '~/other/*.md', files: 2 })
    expect(ompPath('/home/user/proj', '/home/user/proj', HOME)).toBe('.')
    expect(ompPath('/etc/hosts', '/home/user/proj', HOME)).toBe('/etc/hosts')
  })

  it('grep: pattern, matches, files and folder', () => {
    expect(byTarget('ompActivity').omp).toMatchObject({ target: 'ompActivity', scope: 'server', matches: 95, files: 20 })
  })

  it('edit: file, +/- counts and the diff', () => {
    const v = tools.find(t => t.omp?.title === 'Edit')!.omp!
    expect(v).toMatchObject({ target: 'TASKS.md', added: 2, removed: 1, diff: true, outLines: 5 })
    expect(v.out!.split('\n')[2]).toBe('+15|- [ ] new task')
  })

  it('a tool in error keeps the start of its message', () => {
    const t = byTarget('missing.ts')
    expect(t.error).toBe(true)
    expect(t.omp).toMatchObject({ target: 'scratch/missing.ts:66-82', out: 'Path \'scratch/missing.ts\' not found', ms: 790 })
  })

  it('wait: the jobs it waited for, and how long', () => {
    expect(tools.find(t => t.omp?.title === 'Wait')!.omp).toMatchObject({ target: 'bg_2 tools/merge.sh t-0001 2>&1 | tail -6', ms: 132900 })
  })

  it('a call without result yet stays as called', () => {
    const v = byTarget('logo').omp!
    expect(v).toEqual({ title: 'Web Search', target: 'oh-my-pi logo', intent: 'Searching official logo' })
  })

  it('without the session line (later slice of the file), paths stay under ~ unless the folder is given', () => {
    const tail = text.split('\n').slice(1).join('\n')
    expect(parseLines(tail, 'omp', 0, HOME).find(t => t.omp?.title === 'Grep')!.omp!.scope).toBe('~/proj/server')
    expect(parseLines(tail, 'omp', 0, HOME, [], '/home/user/proj').find(t => t.omp?.title === 'Grep')!.omp!.scope).toBe('server')
  })

  it('unknown tools get a readable title and their first text argument', () => {
    expect(ompToolCall('github_run_watch', { url: 'https://example.com/run/1', i: 'Watching CI' })).toEqual({ title: 'Github Run Watch', target: 'https://example.com/run/1', intent: 'Watching CI' })
    expect(ompToolCall('todo', {})).toEqual({ title: 'Todo' })
  })

  it('Claude and Codex tools get no omp view', () => {
    const claude = JSON.stringify({ type: 'assistant', timestamp: '2026-01-01T00:00:00Z', message: { content: [{ type: 'tool_use', id: 'x', name: 'Bash', input: { command: 'ls' } }] } })
    expect(parseLines(claude, 'claude', 0, HOME).every(i => !i.omp)).toBe(true)
  })
})

describe('omp tool text', () => {
  it('wall time written like omp', () => {
    expect(ompWall(30)).toBe('0.03s')
    expect(ompWall(712)).toBe('0.71s')
    expect(ompWall(59_990)).toBe('59.99s')
    expect(ompWall(204_000)).toBe('3m24s')
    expect(ompWall(3_780_000)).toBe('1h3m')
    expect(ompWall(-1)).toBe('')
  })

  it('counts after the target', () => {
    expect(ompToolMeta({ title: 'Grep', matches: 95, files: 20, scope: 'server' })).toEqual(['95 matches in 20 files', 'in server'])
    expect(ompToolMeta({ title: 'Grep', matches: 1, files: 1 })).toEqual(['1 match'])
    expect(ompToolMeta({ title: 'Grep', matches: 3, files: 3 })).toEqual(['3 matches'])
    expect(ompToolMeta({ title: 'Glob', files: 2 })).toEqual(['2 files'])
    expect(ompToolMeta({ title: 'Edit', added: 3, removed: 2 })).toEqual(['+3/-2'])
    expect(ompToolMeta({ title: 'Bash', job: 'bg_2' })).toEqual(['Backgrounded: bg_2'])
    expect(ompToolMeta({ title: 'Bash', exit: 2 })).toEqual(['Exit: 2'])
  })

  it('lines cut above the excerpt, and the glyph', () => {
    expect(ompEarlier({ title: 'Bash', out: 'a\nb', outLines: 25 })).toBe(23)
    expect(ompEarlier({ title: 'Bash', out: 'a', outLines: 1 })).toBe(0)
    expect(ompToolGlyph({ title: 'Edit' }, false)).toBe('✎')
    expect(ompToolGlyph({ title: 'Read' }, true)).toBe('⚠')
    expect(ompToolGlyph({ title: 'Read' }, false)).toBe('●')
  })
})
