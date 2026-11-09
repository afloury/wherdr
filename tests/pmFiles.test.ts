import { describe, expect, it } from 'vitest'
import { beyond, fileConflict, overlap, parseFiles } from '../shared/pm/files'
import { parseFilesRead } from '../server/utils/pmFiles'
import type { Task } from '../shared/pm/run'

const task = (id: string, over: Partial<Task> = {}): Task => ({ id, project: 'WEB', title: 'T', description: '', type: 'simple', state: 'working', createdAt: 0, ...over })
const started = { at: 1, started: true, since: 1, proofs: {}, rounds: {} }

describe('declared files', () => {
  it('reads a list as written: one form per path, each once, comments and outside paths left out', () => {
    expect(parseFiles('./app/\ndocs/**\n# a note\n\nshared\\pm\\files.ts, app\n../secret\n.')).toEqual(['app', 'docs', 'shared/pm/files.ts'])
    expect(parseFiles(['a/', 'a'])).toEqual(['a'])
    expect(parseFiles(undefined)).toEqual([])
  })

  it('a folder covers what is in it; a shared prefix is not a folder', () => {
    expect(overlap('app', 'app/x.vue')).toBe(true)
    expect(overlap('app/x.vue', 'app')).toBe(true)
    expect(overlap('app', 'apps/x.vue')).toBe(false)
  })

  it('a start waits behind a started task of its project, not done, that declared or changed the same files', () => {
    const mine = task('WEB-3', { state: 'todo', files: ['server/utils', 'docs/a.md'] })
    const others = [
      task('WEB-1', { step: { ...started, done: true }, changed: ['docs/a.md'] }), // done
      task('OTHER-1', { project: 'OTHER', step: started, files: ['docs'] }), // another project
      task('WEB-4', { state: 'todo', files: ['docs'] }), // not started
      task('WEB-2', { state: 'waiting', step: started, files: ['app'], changed: ['server/utils/pmLaunch.ts'] }),
    ]
    expect(fileConflict(mine, others)).toEqual({ task: 'WEB-2', files: ['server/utils'] })
    expect(fileConflict({ ...mine, files: ['README.md'] }, others)).toBeUndefined()
    expect(fileConflict({ ...mine, files: undefined }, others)).toBeUndefined()
  })

  it('says what changed beyond the declared paths', () => {
    expect(beyond({ files: ['app'], changed: ['app/x.vue', 'docs/a.md'] })).toEqual(['docs/a.md'])
    expect(beyond({ changed: ['docs/a.md'] })).toEqual([])
  })

  it('reads the marker and the diff of a worktree', () => {
    expect(parseFilesRead('app/\n\n--wherdr-files--\napp/x.vue\nnew.ts\n')).toEqual({ files: ['app'], changed: ['app/x.vue', 'new.ts'] })
  })
})
