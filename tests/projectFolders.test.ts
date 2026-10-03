import { describe, expect, it } from 'vitest'
import { projectFolderCandidate, projectsRootFromConfig, projectsRoots } from '../shared/projectFolders'
import { projectFolderKinds } from '../server/utils/projectFolders'
import type { Machine } from '../server/utils/machines'
import type { FsStat } from '../server/utils/fsx'

const HOME = '/home/demo'
const ROOTS = [`${HOME}/.herdr-projects`]

describe('projectFolderCandidate', () => {
  it('recognizes a project folder under the projects root', () => {
    expect(projectFolderCandidate(`${HOME}/.herdr-projects/acme`, ROOTS)).toEqual({ kind: 'project', projectDir: `${HOME}/.herdr-projects/acme` })
    expect(projectFolderCandidate(`${HOME}/.herdr-projects/acme/`, ROOTS)?.kind).toBe('project')
  })

  it('recognizes a thread folder of a project', () => {
    expect(projectFolderCandidate(`${HOME}/.herdr-projects/acme/threads/t-0042`, ROOTS))
      .toEqual({ kind: 'thread', projectDir: `${HOME}/.herdr-projects/acme` })
  })

  it('ignores the root itself, other subfolders, hidden entries and other places', () => {
    for (const d of [
      `${HOME}/.herdr-projects`, `${HOME}/.herdr-projects/acme/uploads`, `${HOME}/.herdr-projects/acme/threads`,
      `${HOME}/.herdr-projects/acme/threads/notes`, `${HOME}/.herdr-projects/.cache`, `${HOME}/code/acme`,
      `${HOME}/.herdr-projects-old/acme`, 'relative/.herdr-projects/acme',
    ]) expect(projectFolderCandidate(d, ROOTS), d).toBeNull()
  })

  it('uses every given root', () => {
    expect(projectFolderCandidate('/srv/projects/acme', ['/srv/projects', ...ROOTS])?.kind).toBe('project')
  })
})

describe('projects roots', () => {
  it('reads a top-level root from config.toml, ~ expanded', () => {
    expect(projectsRootFromConfig('root = "~/work/projects"\n', HOME)).toBe(`${HOME}/work/projects`)
    expect(projectsRootFromConfig("# comment\nroot = '/srv/projects/' # trailing\n", HOME)).toBe('/srv/projects')
  })

  it('ignores a root inside a table, an empty or relative one, and missing keys', () => {
    expect(projectsRootFromConfig('[defaults]\nroot = "/srv/x"\n', HOME)).toBeNull()
    expect(projectsRootFromConfig('root = ""\n', HOME)).toBeNull()
    expect(projectsRootFromConfig('root = "projects"\n', HOME)).toBeNull()
    expect(projectsRootFromConfig('root = "/srv/../etc"\n', HOME)).toBeNull()
    expect(projectsRootFromConfig('thread_profile = "codex"\n', HOME)).toBeNull()
  })

  it('always keeps the default root, the configured one first', () => {
    expect(projectsRoots(HOME, null)).toEqual(ROOTS)
    expect(projectsRoots(`${HOME}/`, 'root = "/srv/projects"')).toEqual(['/srv/projects', ...ROOTS])
    expect(projectsRoots(HOME, 'root = "~/.herdr-projects"')).toEqual(ROOTS)
  })
})

function fakeMachine(key: string, files: string[], config: string | null = null): Machine & { stats: string[][] } {
  const stats: string[][] = []
  const file: FsStat = { size: 1, mtimeMs: 0, isFile: true, isDir: false }
  return {
    key, home: HOME, stats,
    fs: {
      readFile: async (p: string) => {
        if (p === `${HOME}/.config/herdr-projects/config.toml` && config !== null) return config
        throw new Error('ENOENT')
      },
      statMany: async (ps: string[]) => { stats.push(ps); return ps.map(p => (files.includes(p) ? file : null)) },
    },
  } as unknown as Machine & { stats: string[][] }
}

describe('projectFolderKinds', () => {
  it('marks project and thread folders whose project has a PROJECT.md', async () => {
    const m = fakeMachine('k1', [`${HOME}/.herdr-projects/acme/PROJECT.md`])
    const dirs = [`${HOME}/code/acme`, `${HOME}/.herdr-projects/acme`, `${HOME}/.herdr-projects/acme/threads/t-0001`, `${HOME}/.herdr-projects/ghost`]
    expect(await projectFolderKinds(m, dirs)).toEqual({
      [`${HOME}/.herdr-projects/acme`]: 'project',
      [`${HOME}/.herdr-projects/acme/threads/t-0001`]: 'thread',
    })
    // One stat per project folder, none for ordinary folders.
    expect(m.stats).toEqual([[`${HOME}/.herdr-projects/acme/PROJECT.md`, `${HOME}/.herdr-projects/ghost/PROJECT.md`]])
  })

  it('follows the root configured in config.toml', async () => {
    const m = fakeMachine('k2', ['/srv/projects/acme/PROJECT.md'], 'root = "/srv/projects"\n')
    expect(await projectFolderKinds(m, ['/srv/projects/acme'])).toEqual({ '/srv/projects/acme': 'project' })
  })

  it('does not stat anything without candidates, and never throws', async () => {
    const m = fakeMachine('k3', [])
    expect(await projectFolderKinds(m, [`${HOME}/code/acme`])).toEqual({})
    expect(m.stats).toEqual([])
    const broken = { ...fakeMachine('k4', []), fs: { readFile: async () => '', statMany: async () => { throw new Error('ssh down') } } } as unknown as Machine
    expect(await projectFolderKinds(broken, [`${HOME}/.herdr-projects/acme`])).toEqual({})
  })
})
