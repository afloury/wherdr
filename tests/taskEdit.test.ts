import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseTasks } from '../shared/projectBoard'
import { moveTaskInText } from '../shared/taskEdit'
import { WRITE_TASKS_SCRIPT, checkMove } from '../server/utils/taskWrite'

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

  it('writes when the file is unchanged, keeping its mode', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'taskedit-'))
    const f = path.join(dir, 'TASKS.md')
    fs.writeFileSync(f, 'old\n', { mode: 0o640 })
    fs.chmodSync(f, 0o640)
    expect(run(f, sha('old\n'), 'new\n')).toBe(0)
    expect(fs.readFileSync(f, 'utf8')).toBe('new\n')
    expect(fs.statSync(f).mode & 0o777).toBe(0o640)
    expect(fs.readdirSync(dir)).toEqual(['TASKS.md'])
    fs.rmSync(dir, { recursive: true })
  })

  it('refuses a changed or missing file, writing nothing', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'taskedit-'))
    const f = path.join(dir, 'TASKS.md')
    fs.writeFileSync(f, 'changed\n')
    expect(run(f, sha('old\n'), 'new\n')).toBe(45)
    expect(fs.readFileSync(f, 'utf8')).toBe('changed\n')
    expect(run(path.join(dir, 'none.md'), sha('old\n'), 'new\n')).toBe(44)
    expect(fs.readdirSync(dir)).toEqual(['TASKS.md'])
    fs.rmSync(dir, { recursive: true })
  })

  it('has a hash tool available', () => {
    expect(execFileSync('sh', ['-c', 'command -v sha256sum || command -v shasum']).toString().trim()).not.toBe('')
  })
})
