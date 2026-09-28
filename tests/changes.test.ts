import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseDiff, parseNumstat, parseStatus, readChangeStatus, readChanges } from '../server/utils/changes'
import type { Machine } from '../server/utils/machines'

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')

describe('Git changes parsing', () => {
  it('reads porcelain status, including spaces, deletion, untracked files and a rename', () => {
    const raw = fixture('changes-status.txt').replaceAll('\\0', '\0').replaceAll('\n', '\0')
    expect(parseStatus(raw)).toEqual([
      { path: 'src/app.ts', status: ' M' },
      { path: 'new file.ts', status: 'A ' },
      { path: 'removed.ts', status: ' D' },
      { path: 'fresh space.txt', status: '??' },
      { path: 'renamed-new.ts', previousPath: 'renamed-old.ts', status: 'R ' },
    ])
  })

  it('colors hunks without counting the +++ and --- headers', () => {
    const diff = parseDiff(fixture('changes-diff.txt'))
    expect([diff.added, diff.deleted, diff.binary]).toEqual([1, 1, false])
    expect(diff.lines.map(l => l.kind)).toContain('hunk')
    expect(diff.lines.find(l => l.text === '+new()')?.kind).toBe('add')
    expect(diff.lines.find(l => l.text === ' unchanged()')?.kind).toBe('context')
    expect(parseDiff('Binary files a/x and b/x differ\n').binary).toBe(true)
  })

  it('reads exact numstat counts, including binary and renamed paths', () => {
    const raw = ['12\t3\tsrc/app.ts', '-\t-\timage.png', '0\t5\t', 'old.ts', 'new.ts', ''].join('\0')
    expect([...parseNumstat(raw)]).toEqual([
      ['src/app.ts', { added: 12, deleted: 3 }],
      ['image.png', { added: null, deleted: null }],
      ['new.ts', { added: 0, deleted: 5 }],
    ])
  })

  it('runs Git through the remote machine with paths only in positional arguments', async () => {
    const cwd = "/Users/me/project's work"
    const name = 'file;$(touch sentinel).txt'
    const calls: { script: string, args: string[] }[] = []
    const exec: NonNullable<Machine['exec']> = async (script, args = []) => {
      calls.push({ script, args })
      let out = ''
      if (script.includes('rev-parse --show-toplevel')) out = `${cwd}\n`
      else if (script.includes('branch --show-current')) out = 'feature\n'
      else if (script.includes('rev-parse --verify HEAD')) out = 'abc123\n'
      else if (script.includes('status --porcelain')) out = `?? ${name}\0`
      else if (script.includes('diff --no-index --numstat')) out = `1\t0\t\0/dev/null\0${cwd}/${name}\0`
      else if (script.includes('diff --no-index')) out = `diff --git a/${name} b/${name}\n@@ -0,0 +1 @@\n+hello\n`
      return { code: 0, stdout: Buffer.from(out), stderr: '' }
    }
    const data = await readChanges({ exec } as Machine, cwd)
    expect(data.working?.files[0]?.path).toBe(name)
    expect(data.working?.files[0]?.added).toBe(1)
    expect(calls.length).toBeGreaterThan(4)
    expect(calls.every(c => !c.script.includes(cwd) && !c.script.includes(name))).toBe(true)
    expect(calls.some(c => c.args.includes(`${cwd}/${name}`))).toBe(true)
  })

  it('counts modified and untracked files for a remote close without requesting diffs', async () => {
    const calls: string[] = []
    const exec: NonNullable<Machine['exec']> = async (script) => {
      calls.push(script)
      const out = script.includes('rev-parse --show-toplevel') ? '/tmp/checkout\n'
        : ' M src/app.ts\0?? new.txt\0?? another.txt\0'
      return { code: 0, stdout: Buffer.from(out), stderr: '' }
    }
    expect(await readChangeStatus({ exec } as Machine, '/tmp/checkout')).toEqual({
      git: true, modified: 1, untracked: 2, truncated: false,
    })
    expect(calls).toHaveLength(2)
    expect(calls.every(s => !s.includes(' diff --'))).toBe(true)
  })
})
