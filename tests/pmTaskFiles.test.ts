import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { findTaskFiles, openTaskFile, taskCandidates, taskRoots, taskSource } from '../server/utils/pmTaskFiles'
import { localMachine } from '../server/utils/machines'
import type { Task } from '../shared/pm/run'
import type { Project } from '../shared/pm/project'

const roots = taskRoots('/home/u', 'WEB-3', '.wherdr/pm')

describe('task roots', () => {
  it('the worktree and the task folder under the home folder', () => {
    expect(roots).toEqual({ worktree: '/home/u/.wherdr/pm/worktrees/WEB-3', task: '/home/u/.wherdr/pm/tasks/WEB-3' })
  })
})

describe('task file candidates', () => {
  it('a relative path is looked for in the worktree, then in the task folder', () => {
    expect(taskCandidates('docs/plan.md', roots)).toEqual([{ root: 'worktree', rel: 'docs/plan.md' }, { root: 'task', rel: 'docs/plan.md' }])
  })

  it('./ and doubled slashes are the same path', () => {
    expect(taskCandidates('./docs//plan.md', roots)[0]).toEqual({ root: 'worktree', rel: 'docs/plan.md' })
    expect(taskCandidates('catalogue.md', roots)[0]).toEqual({ root: 'worktree', rel: 'catalogue.md' })
  })

  it('an absolute path is accepted inside a root, made relative to it', () => {
    expect(taskCandidates('/home/u/.wherdr/pm/worktrees/WEB-3/docs/a.md', roots)).toEqual([{ root: 'worktree', rel: 'docs/a.md' }])
    expect(taskCandidates('/home/u/.wherdr/pm/tasks/WEB-3/report.md', roots)).toEqual([{ root: 'task', rel: 'report.md' }])
  })

  it('an absolute path outside both roots, another task\'s, or a root itself is refused', () => {
    expect(taskCandidates('/etc/passwd', roots)).toEqual([])
    expect(taskCandidates('/home/u/.wherdr/pm/worktrees/WEB-30/a.md', roots)).toEqual([])
    expect(taskCandidates('/home/u/.wherdr/pm/worktrees/WEB-4/a.md', roots)).toEqual([])
    expect(taskCandidates('/home/u/.wherdr/pm/worktrees/WEB-3', roots)).toEqual([])
    expect(taskCandidates('/home/u/.wherdr/pm/worktrees/WEB-3/', roots)).toEqual([])
  })

  it('.. segments are refused, relative or absolute', () => {
    expect(taskCandidates('../secret.md', roots)).toEqual([])
    expect(taskCandidates('docs/../../x.md', roots)).toEqual([])
    expect(taskCandidates('docs/../x.md', roots)).toEqual([])
    expect(taskCandidates('/home/u/.wherdr/pm/worktrees/WEB-3/../WEB-4/a.md', roots)).toEqual([])
    expect(taskCandidates('..\\secret.md', roots)).toEqual([])
  })

  it('~, empty, NUL, folders and non-strings are refused', () => {
    for (const w of ['~/a.md', '', '   ', '.', './', 'a\0b.md', undefined, 3, null, 'x'.repeat(2000)]) expect(taskCandidates(w, roots)).toEqual([])
  })
})

describe('task files found on a machine', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'wherdr-taskfiles-'))
  afterAll(() => fs.rmSync(home, { recursive: true, force: true }))
  const m = { ...localMachine, home }
  const r = taskRoots(home, 'WEB-3')
  const put = (p: string, text = 'x') => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text) }
  put(`${r.worktree}/docs/plan.md`)
  put(`${r.worktree}/both.md`)
  put(`${r.task}/both.md`)
  put(`${r.task}/report.md`)
  fs.mkdirSync(`${r.worktree}/folder.md`)
  put(path.join(home, 'outside.md'))
  fs.symlinkSync(path.join(home, 'outside.md'), `${r.worktree}/link.md`)

  it('lists a path with the first root it is a file in, and skips the others', async () => {
    const found = await findTaskFiles(m, 'WEB-3', ['docs/plan.md', './docs/plan.md', 'both.md', 'report.md', 'missing.md', 'folder.md', `${r.task}/report.md`, '../outside.md', '/etc/passwd', 7])
    expect(found).toEqual({
      'docs/plan.md': { root: 'worktree', rel: 'docs/plan.md' },
      './docs/plan.md': { root: 'worktree', rel: 'docs/plan.md' },
      'both.md': { root: 'worktree', rel: 'both.md' },
      'report.md': { root: 'task', rel: 'report.md' },
      [`${r.task}/report.md`]: { root: 'task', rel: 'report.md' },
    })
  })

  it('a bare name is found below the top of the worktree (a step says catalogue.md, the file is in a folder), never in .git or node_modules', async () => {
    put(`${r.worktree}/library/deep/catalogue.md`)
    put(`${r.worktree}/node_modules/pkg/only-there.md`)
    put(`${r.task}/notes/task-note.md`)
    expect(await findTaskFiles(m, 'WEB-3', ['catalogue.md', 'only-there.md', 'task-note.md', 'plan.md', 'docs/nope.md'])).toEqual({
      'catalogue.md': { root: 'worktree', rel: 'library/deep/catalogue.md' },
      'plan.md': { root: 'worktree', rel: 'docs/plan.md' },
      'task-note.md': { root: 'task', rel: 'notes/task-note.md' },
    })
  })

  it('a symlink to a file outside its root is not offered', async () => {
    expect(await findTaskFiles(m, 'WEB-3', ['link.md'])).toEqual({})
  })

  it('no paths, no run', async () => {
    expect(await findTaskFiles(m, 'WEB-3', [])).toEqual({})
  })
})

describe('task source', () => {
  const task = { id: 'WEB-3', project: 'WEB', machine: 'mac' } as Task
  const project = { key: 'WEB', machine: 'mac' } as Project
  const deps = {
    store: { task: async (id: unknown) => (id === 'WEB-3' ? task : undefined), projects: async () => [project] },
    machine: async (key: string) => ({ ...localMachine, key, home: '/home/u' }),
  } as unknown as Parameters<typeof taskSource>[2]

  it('is the root of the task, on the machine it started on', async () => {
    const s = await taskSource('WEB-3', 'task', deps)
    expect(s.root).toBe('/home/u/.wherdr/pm/tasks/WEB-3')
    expect(s.m.key).toBe('mac')
    expect((await taskSource('WEB-3', 'worktree', deps)).root).toBe('/home/u/.wherdr/pm/worktrees/WEB-3')
  })

  it('refuses an unknown task and an unknown root', async () => {
    await expect(taskSource('NOPE-1', 'task', deps)).rejects.toThrow('Unknown task')
    await expect(taskSource('WEB-3', '/etc', deps)).rejects.toThrow('Unknown folder')
    await expect(taskSource('WEB-3', undefined, deps)).rejects.toThrow('Unknown folder')
  })
})

describe('a task file opened in the default application', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'wherdr-taskopen-'))
  afterAll(() => fs.rmSync(home, { recursive: true, force: true }))
  const r = taskRoots(home, 'WEB-3')
  fs.mkdirSync(`${r.worktree}/docs`, { recursive: true })
  fs.writeFileSync(`${r.worktree}/docs/plan.md`, 'x')
  fs.writeFileSync(path.join(home, 'outside.md'), 'x')
  fs.symlinkSync(path.join(home, 'outside.md'), `${r.worktree}/link.md`)
  const opened: string[] = []
  const deps = (local = true, ok = true) => ({
    store: { task: async () => ({ id: 'WEB-3', project: 'WEB', machine: 'mac' }), projects: async () => [{ key: 'WEB', machine: 'mac' }] },
    machine: async () => ({ ...localMachine, home, local }),
    open: async (file: string) => { opened.push(file); return ok },
  }) as unknown as Parameters<typeof openTaskFile>[2]
  const open = (rel: unknown, d = deps(), same = true, root = 'worktree') => openTaskFile({ task: 'WEB-3', root, rel }, same, d)

  it('opens a file of the task\'s worktree by its absolute path', async () => {
    expect(await open('docs/plan.md')).toEqual({ ok: true })
    expect(opened).toEqual([`${r.worktree}/docs/plan.md`])
  })

  it('refuses a browser on another computer and a task on another machine, opening nothing', async () => {
    opened.length = 0
    await expect(open('docs/plan.md', deps(), false)).rejects.toThrow('browser on the task')
    await expect(open('docs/plan.md', deps(false))).rejects.toThrow('this computer')
    expect(opened).toEqual([])
  })

  it('refuses what is no regular file of the task: missing, .., a link out of the root, another root', async () => {
    opened.length = 0
    for (const rel of ['missing.md', '../outside.md', 'link.md', 'docs', '', 7]) await expect(open(rel)).rejects.toThrow()
    await expect(open('docs/plan.md', deps(), true, 'task')).rejects.toThrow('does not exist')
    await expect(open('docs/plan.md', deps(), true, '/etc')).rejects.toThrow('Unknown folder')
    expect(opened).toEqual([])
  })

  it('says so when no application opens it', async () => {
    await expect(open('docs/plan.md', deps(true, false))).rejects.toThrow('No application')
  })
})
