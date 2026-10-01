import { describe, expect, it } from 'vitest'
import { cleanProjectInput, projectCommandArgs, projectNameOk, repoArgument, repoState, suggestedProjectName } from '../shared/projectsActions'

describe('New project: suggested name', () => {
  it('refuses "~", paths and names without a letter or digit', () => {
    for (const bad of ['', '  ', '~', '~/code', '/home/demo', 'a/b', 'a\\b', '..', 'x..y', '---', '✨'])
      expect(projectNameOk(bad), bad).toBe(false)
    for (const ok of ['Demo', 'my app', 'app.v2', 'wherdr', 'Été 2026'])
      expect(projectNameOk(ok), ok).toBe(true)
  })

  it('New project: the repository folder name, otherwise nothing (never the space)', () => {
    expect(suggestedProjectName('new', { repo: '/home/demo/code/app', space: '~' })).toBe('app')
    expect(suggestedProjectName('new', { repo: '/home/demo/code/app/', space: 'x' })).toBe('app')
    expect(suggestedProjectName('new', { repo: '', space: 'Demo' })).toBe('')
    expect(suggestedProjectName('new', { repo: null, space: '~' })).toBe('')
    expect(suggestedProjectName('new', { repo: '/home/demo/..' })).toBe('')
  })

  it('adoption: the space label only if it makes a valid name', () => {
    expect(suggestedProjectName('adopt-workspace', { space: 'Demo' })).toBe('Demo')
    expect(suggestedProjectName('adopt-workspace', { space: '~' })).toBe('')
    expect(suggestedProjectName('adopt-workspace', { space: '~/code/app' })).toBe('')
  })
})

describe('New project: state of the chosen folder', () => {
  it('repository, subfolder of a repository, or nothing', () => {
    expect(repoState('/home/demo/app', '/home/demo/app')).toBe('repo')
    expect(repoState('/home/demo/app/', '/home/demo/app')).toBe('repo')
    expect(repoState('/home/demo/app/src/lib', '/home/demo/app')).toBe('inside')
    expect(repoState('/home/demo/app2', '/home/demo/app')).toBe('none')
    expect(repoState('/home/demo', null)).toBe('none')
    expect(repoState('/home/demo/notes', '')).toBe('none')
  })
})

describe('New project : --repo et machine', () => {
  const local = { local: true, profileId: null }
  const laptop = { local: false, profileId: '0123abcd0123abcd' }
  const other = { local: false, profileId: 'fedc4321fedc4321' }

  it('same machine: the path alone', () => {
    expect(repoArgument('/home/demo/app', local, local)).toBe('/home/demo/app')
    expect(repoArgument('/Users/demo/app', laptop, laptop)).toBe('/Users/demo/app')
  })

  it('local project, remote repository: path@Herdr id of the machine', () => {
    expect(repoArgument('/Users/demo/app', laptop, local)).toBe('/Users/demo/app@0123abcd0123abcd')
    // Path containing "@": herdr-projects cuts at the last "@".
    expect(repoArgument('/Users/demo/a@b', laptop, local)).toBe('/Users/demo/a@b@0123abcd0123abcd')
  })

  it('refuses what herdr-projects would misread or could not reach', () => {
    expect(repoArgument('/home/demo/app', local, laptop)).toBeNull()
    expect(repoArgument('/Users/demo/app', other, laptop)).toBeNull()
    expect(repoArgument('/Users/demo/app', { local: false, profileId: null }, local)).toBeNull()
    expect(repoArgument('/Users/demo/app', { local: false, profileId: 'Mac Demo' }, local)).toBeNull()
    expect(repoArgument('/home/demo/app@v2', local, local)).toBeNull()
  })

  it('argv of new with a remote repository; the machine is not passed as is', () => {
    const input = cleanProjectInput('new', { name: 'App', goal: '', repo: '/Users/demo/app', machine: 'a1b2c3d4' })!
    expect(input).toEqual({ name: 'App', repo: '/Users/demo/app', machine: 'a1b2c3d4' })
    input.repo = repoArgument(input.repo!, laptop, local)!
    expect(projectCommandArgs('new', input, { session: 'default' })).toEqual(['new', 'App', '--repo', '/Users/demo/app@0123abcd0123abcd'])
    expect(cleanProjectInput('new', { name: 'App', machine: 'x'.repeat(65) })).toBeNull()
    expect(cleanProjectInput('new', { name: 'App', repo: '', machine: '' })).toEqual({ name: 'App' })
  })
})
