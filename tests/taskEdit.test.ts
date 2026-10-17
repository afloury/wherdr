import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parseTasks } from '../shared/projectBoard'
import { moveTaskInText } from '../shared/taskEdit'
import { WRITE_TASKS_SCRIPT, applyMove, checkMove, localExec, serialized } from '../server/utils/taskWrite'

const MD = `# Demo

Intro text.

## In queue
- [ ] Alpha (agent)
  detail of alpha

  more alpha
- [ ] Beta

## To do
- [ ] Gamma [b:red(bug)]
- [ ] Delta
    \`\`\`
  - not a task
    \`\`\`
- [ ] Epsilon

## Backlog
- [ ] Zeta
`

const ref = (md: string, list: number, index: number) => ({ list, index, text: parseTasks(md)[list]!.tasks[index]!.text })
const ok = (r: ReturnType<typeof moveTaskInText>) => {
  if (!r.ok) throw new Error(r.error)
  return r.text
}
const sortedLines = (s: string) => s.split('\n').sort()

describe('moveTaskInText', () => {
  it('moves a task down with its detail lines, nothing else changes', () => {
    const out = ok(moveTaskInText(MD, ref(MD, 0, 0), 'down'))
    expect(out).toContain('## In queue\n- [ ] Beta\n- [ ] Alpha (agent)\n  detail of alpha\n\n  more alpha\n\n## To do')
    expect(sortedLines(out)).toEqual(sortedLines(MD))
    expect(parseTasks(out)[0]!.tasks.map(t => t.text)).toEqual(['Beta', 'Alpha'])
  })

  it('moves a task up, keeping a fenced detail block attached', () => {
    const out = ok(moveTaskInText(MD, ref(MD, 1, 2), 'up'))
    expect(parseTasks(out)[1]!.tasks.map(t => t.text)).toEqual(['Gamma', 'Epsilon', 'Delta'])
    expect(out).toContain('- [ ] Delta\n    ```\n  - not a task\n    ```\n\n## Backlog')
    expect(sortedLines(out)).toEqual(sortedLines(MD))
  })

  it('up then down gives the file back byte for byte', () => {
    const down = ok(moveTaskInText(MD, ref(MD, 1, 0), 'down'))
    expect(ok(moveTaskInText(down, ref(down, 1, 1), 'up'))).toBe(MD)
  })

  it('refuses the edges', () => {
    expect(moveTaskInText(MD, ref(MD, 0, 0), 'up')).toEqual({ ok: false, error: 'edge' })
    expect(moveTaskInText(MD, ref(MD, 2, 0), 'down')).toEqual({ ok: false, error: 'edge' })
  })

  it('queues a task at the end of In queue', () => {
    const out = ok(moveTaskInText(MD, ref(MD, 2, 0), 'queue'))
    const lists = parseTasks(out)
    expect(lists[0]!.tasks.map(t => t.text)).toEqual(['Alpha', 'Beta', 'Zeta'])
    expect(lists[2]!.tasks).toEqual([])
    expect(sortedLines(out)).toEqual(sortedLines(MD))
  })

  it('takes a task out of the queue to the top of To do', () => {
    const out = ok(moveTaskInText(MD, ref(MD, 0, 0), 'todo'))
    const lists = parseTasks(out)
    expect(lists[0]!.tasks.map(t => t.text)).toEqual(['Beta'])
    expect(lists[1]!.tasks.map(t => t.text)).toEqual(['Alpha', 'Gamma', 'Delta', 'Epsilon'])
    expect(out).toContain('## To do\n- [ ] Alpha (agent)\n  detail of alpha\n\n  more alpha\n- [ ] Gamma')
  })

  it('puts a task from another list at the end of To do', () => {
    const out = ok(moveTaskInText(MD, ref(MD, 2, 0), 'todo'))
    expect(parseTasks(out)[1]!.tasks.map(t => t.text)).toEqual(['Gamma', 'Delta', 'Epsilon', 'Zeta'])
  })

  it('fills an empty list right under its heading', () => {
    const md = '## To do\n- [ ] A\n\n## En file\n\n## Backlog\n'
    expect(ok(moveTaskInText(md, ref(md, 0, 0), 'queue'))).toBe('## To do\n\n## En file\n- [ ] A\n\n## Backlog\n')
  })

  it('keeps CRLF line endings and a missing final newline', () => {
    const md = '## To do\r\n- [ ] A\r\n- [ ] B'
    expect(ok(moveTaskInText(md, ref(md, 0, 1), 'up'))).toBe('## To do\r\n- [ ] B\r\n- [ ] A')
    const lf = '## To do\n- [ ] A\n- [ ] B'
    expect(ok(moveTaskInText(lf, ref(lf, 0, 0), 'down'))).toBe('## To do\n- [ ] B\n- [ ] A')
  })

  it('refuses a task that does not match, or a missing list', () => {
    expect(moveTaskInText(MD, { list: 1, index: 0, text: 'Other' }, 'down')).toEqual({ ok: false, error: 'not_found' })
    expect(moveTaskInText(MD, { list: 9, index: 0, text: 'Gamma' }, 'down')).toEqual({ ok: false, error: 'not_found' })
    const md = '## To do\n- [ ] A\n'
    expect(moveTaskInText(md, ref(md, 0, 0), 'queue')).toEqual({ ok: false, error: 'no_list' })
    expect(moveTaskInText(md, ref(md, 0, 0), 'todo')).toEqual({ ok: false, error: 'same_list' })
  })

  it('indexes lists like parseTasks (fences, # headings)', () => {
    const md = '## To do\n```\n## Not a list\n```\n- [ ] A\n# Other\n- [ ] ignored\n## Backlog\n- [ ] B\n'
    const lists = parseTasks(md)
    expect(lists.map(l => l.title)).toEqual(['To do', 'Backlog'])
    const out = ok(moveTaskInText(md, ref(md, 1, 0), 'todo'))
    expect(out).toBe('## To do\n```\n## Not a list\n```\n- [ ] A\n- [ ] B\n# Other\n- [ ] ignored\n## Backlog\n')
  })
})

describe('checkMove', () => {
  const hash = 'a'.repeat(64)
  it('accepts a well-formed move', () => {
    expect(checkMove({ list: 1, index: 0, text: 'A', hash, move: 'up' })).toEqual({ ref: { list: 1, index: 0, text: 'A' }, move: 'up', hash })
  })
  it('refuses anything else', () => {
    for (const b of [{ list: 1, index: 0, text: 'A', hash, move: 'now' }, { list: -1, index: 0, text: 'A', hash, move: 'up' }, { list: 0, index: 0.5, text: 'A', hash, move: 'up' }, { list: 0, index: 0, text: '', hash, move: 'up' }, { list: 0, index: 0, text: 'A', hash: 'x', move: 'up' }])
      expect(() => checkMove(b)).toThrow('Invalid task move')
  })
})

describe('WRITE_TASKS_SCRIPT', () => {
  const sha = (s: string) => createHash('sha256').update(s).digest('hex')
  const run = (file: string, want: string, input: string) => spawnSync('sh', ['-c', WRITE_TASKS_SCRIPT, 'sh', file, want], { input }).status
  const start = (file: string, want: string, input: string) => new Promise<number | null>((resolve) => {
    const c = spawn('sh', ['-c', WRITE_TASKS_SCRIPT, 'sh', file, want])
    c.on('close', resolve)
    c.stdin.end(input)
  })
  let dir = ''
  let f = ''
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'taskedit-'))
    f = path.join(dir, 'TASKS.md')
  })
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

  it('writes when the file is unchanged, keeping its mode', () => {
    fs.writeFileSync(f, 'old\n')
    fs.chmodSync(f, 0o640)
    expect(run(f, sha('old\n'), 'new\n')).toBe(0)
    expect(fs.readFileSync(f, 'utf8')).toBe('new\n')
    expect(fs.statSync(f).mode & 0o777).toBe(0o640)
    expect(fs.readdirSync(dir)).toEqual(['TASKS.md'])
  })

  it('refuses a changed or missing file, writing nothing', () => {
    fs.writeFileSync(f, 'changed\n')
    expect(run(f, sha('old\n'), 'new\n')).toBe(45)
    expect(fs.readFileSync(f, 'utf8')).toBe('changed\n')
    expect(run(path.join(dir, 'none.md'), sha('old\n'), 'new\n')).toBe(44)
    expect(fs.readdirSync(dir)).toEqual(['TASKS.md'])
  })

  it('two writes from the same read: exactly one wins, the other is refused', async () => {
    fs.writeFileSync(f, 'old\n')
    // Both wait on a held lock, then race for it once released.
    fs.mkdirSync(`${f}.wherdr-lock`)
    const both = Promise.all([start(f, sha('old\n'), 'first\n'), start(f, sha('old\n'), 'second\n')])
    await new Promise(r => setTimeout(r, 300))
    fs.rmdirSync(`${f}.wherdr-lock`)
    const codes = (await both).sort()
    expect(codes).toEqual([0, 45])
    expect(['first\n', 'second\n']).toContain(fs.readFileSync(f, 'utf8'))
    expect(fs.readdirSync(dir)).toEqual(['TASKS.md'])
  })

  it('many concurrent writes from the same read: one success, no leftovers', async () => {
    fs.writeFileSync(f, 'old\n')
    const codes = await Promise.all(Array.from({ length: 6 }, (_, i) => start(f, sha('old\n'), `w${i}\n`)))
    expect(codes.filter(c => c === 0)).toHaveLength(1)
    expect(codes.filter(c => c === 45)).toHaveLength(5)
    expect(fs.readdirSync(dir)).toEqual(['TASKS.md'])
  })

  it('never removes a stale lock: two writers recovering the same one are both refused', async () => {
    fs.writeFileSync(f, 'old\n')
    const lock = `${f}.wherdr-lock`
    fs.mkdirSync(lock)
    fs.writeFileSync(`${lock}/owner`, 'killed-writer')
    const old = new Date(Date.now() - 5 * 60_000)
    fs.utimesSync(lock, old, old)
    const codes = await Promise.all([start(f, sha('old\n'), 'first\n'), start(f, sha('old\n'), 'second\n')])
    expect(codes).toEqual([48, 48])
    expect(fs.readFileSync(f, 'utf8')).toBe('old\n')
    expect(fs.readFileSync(`${lock}/owner`, 'utf8')).toBe('killed-writer')
    expect(fs.readdirSync(dir).sort()).toEqual(['TASKS.md', 'TASKS.md.wherdr-lock'])
    // Explicit recovery: the folder removed, the next write goes through.
    fs.rmSync(lock, { recursive: true })
    expect(run(f, sha('old\n'), 'new\n')).toBe(0)
    expect(fs.readdirSync(dir)).toEqual(['TASKS.md'])
  })

  it('does not remove a lock that another writer owns', async () => {
    fs.writeFileSync(f, 'old\n')
    const lock = `${f}.wherdr-lock`
    // A writer whose hash check fails exits while holding the lock; meanwhile
    // its owner token is replaced, as if the lock had been taken again.
    const slow = path.join(dir, 'bin')
    fs.mkdirSync(slow)
    fs.writeFileSync(path.join(slow, 'sha256sum'), `#!/bin/sh\nprintf other > '${lock}/owner'\nexec ${execFileSync('sh', ['-c', 'command -v sha256sum']).toString().trim()} "$@"\n`, { mode: 0o755 })
    const r = spawnSync('sh', ['-c', WRITE_TASKS_SCRIPT, 'sh', f, sha('changed\n')], { input: 'new\n', env: { ...process.env, PATH: `${slow}:${process.env.PATH}` } })
    expect(r.status).toBe(45)
    expect(fs.readFileSync(`${lock}/owner`, 'utf8')).toBe('other')
  })

  it('gives up on a lock that stays held', () => {
    fs.writeFileSync(f, 'old\n')
    fs.mkdirSync(`${f}.wherdr-lock`)
    expect(run(f, sha('old\n'), 'new\n')).toBe(47)
    expect(fs.readFileSync(f, 'utf8')).toBe('old\n')
    expect(fs.readdirSync(dir).sort()).toEqual(['TASKS.md', 'TASKS.md.wherdr-lock'])
  }, 20_000)

  it('has a hash tool available', () => {
    expect(execFileSync('sh', ['-c', 'command -v sha256sum || command -v shasum']).toString().trim()).not.toBe('')
  })
})

describe('applyMove (local, serialized)', () => {
  it('two moves sent with the same hash at once: one applied, the other refused', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'taskedit-'))
    const f = path.join(dir, 'TASKS.md')
    const md = '## To do\n- [ ] A\n- [ ] B\n- [ ] C\n'
    fs.writeFileSync(f, md)
    const io = { read: async (p: string) => fs.readFileSync(p), exec: localExec }
    const hash = createHash('sha256').update(md).digest('hex')
    const key = `local|${f}`
    const results = await Promise.allSettled([
      serialized(key, () => applyMove(io, f, { list: 0, index: 0, text: 'A' }, 'down', hash)),
      serialized(key, () => applyMove(io, f, { list: 0, index: 2, text: 'C' }, 'up', hash)),
    ])
    expect(results[0]!.status).toBe('fulfilled')
    expect(results[1]!.status).toBe('rejected')
    expect((results[1] as PromiseRejectedResult).reason.code).toBe('tasks_changed')
    expect(fs.readFileSync(f, 'utf8')).toBe('## To do\n- [ ] B\n- [ ] A\n- [ ] C\n')
    expect(fs.readdirSync(dir)).toEqual(['TASKS.md'])
    fs.rmSync(dir, { recursive: true })
  })

  it('a refused move does not block the next one', async () => {
    const order: string[] = []
    await serialized('k', async () => { order.push('a'); throw new Error('x') }).catch(() => {})
    await serialized('k', async () => { order.push('b') })
    expect(order).toEqual(['a', 'b'])
  })
})
