import { describe, expect, it } from 'vitest'
import { isFolderRef, newRepoName, parseFolderLook, projectFolderOf, repoNameOf } from '../shared/projectFolder'

describe('project folders', () => {
  it('reads what the machine says of a folder', () => {
    expect(parseFolderLook('git\t/home/u/code/app\n')).toEqual({ state: 'git', root: '/home/u/code/app' })
    expect(parseFolderLook('notgit\n')).toEqual({ state: 'notgit' })
    expect(parseFolderLook('missing\n')).toEqual({ state: 'missing' })
    expect(parseFolderLook('')).toEqual({ state: 'missing' })
    expect(parseFolderLook('git\trelative')).toEqual({ state: 'missing' })
  })

  it('finds a root on the board by its folder', () => {
    const repos = { app: '/home/u/code/app/', web: '/home/u/web' }
    expect(repoNameOf(repos, '/home/u/code/app')).toBe('app')
    expect(repoNameOf(repos, '/home/u/other')).toBeNull()
    expect(repoNameOf(null, '/x')).toBeNull()
    expect(projectFolderOf({ state: 'git', root: '/home/u/web' }, repos)).toEqual({ state: 'known', repo: 'web', root: '/home/u/web' })
    expect(projectFolderOf({ state: 'notgit' }, repos)).toEqual({ state: 'notgit' })
  })

  it('predicts the name herdr-projects gives a new repo', () => {
    expect(newRepoName({}, '/Users/u/Projects/team/hub')).toBe('hub')
    expect(newRepoName({ hub: '/a/hub', 'hub-2': '/b/hub' }, '/c/hub')).toBe('hub-3')
    expect(newRepoName({}, '/x/My Site (v2)')).toBe('My-Site--v2-')
    expect(newRepoName({}, '/x/dispatch')).toBe('dispatch-2')
    expect(newRepoName({}, `/x/${'a'.repeat(40)}`)).toBe('a'.repeat(28))
  })

  it('tells a folder from a repo name', () => {
    expect(isFolderRef('/abs')).toBe(true)
    expect(isFolderRef('~/code')).toBe(true)
    expect(isFolderRef('~')).toBe(true)
    expect(isFolderRef('wherdr')).toBe(false)
  })
})
