import { describe, expect, it } from 'vitest'
import { cleanProjectInput, projectCommandArgs, projectNameOk, repoArgument, repoState, suggestedProjectName } from '../shared/projectsActions'

describe('New project : nom proposé', () => {
  it('refuse « ~ », les chemins et les noms sans lettre ni chiffre', () => {
    for (const bad of ['', '  ', '~', '~/code', '/home/demo', 'a/b', 'a\\b', '..', 'x..y', '---', '✨'])
      expect(projectNameOk(bad), bad).toBe(false)
    for (const ok of ['Demo', 'my app', 'app.v2', 'wherdr', 'Été 2026'])
      expect(projectNameOk(ok), ok).toBe(true)
  })

  it('New project : le nom du dossier du dépôt, sinon rien (jamais le space)', () => {
    expect(suggestedProjectName('new', { repo: '/home/demo/code/app', space: '~' })).toBe('app')
    expect(suggestedProjectName('new', { repo: '/home/demo/code/app/', space: 'x' })).toBe('app')
    expect(suggestedProjectName('new', { repo: '', space: 'Demo' })).toBe('')
    expect(suggestedProjectName('new', { repo: null, space: '~' })).toBe('')
    expect(suggestedProjectName('new', { repo: '/home/demo/..' })).toBe('')
  })

  it('adoption : le libellé du space seulement s’il fait un nom valide', () => {
    expect(suggestedProjectName('adopt-workspace', { space: 'Demo' })).toBe('Demo')
    expect(suggestedProjectName('adopt-workspace', { space: '~' })).toBe('')
    expect(suggestedProjectName('adopt-workspace', { space: '~/code/app' })).toBe('')
  })
})

describe('New project : état du dossier choisi', () => {
  it('dépôt, sous-dossier d’un dépôt, ou rien', () => {
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

  it('même machine : le chemin seul', () => {
    expect(repoArgument('/home/demo/app', local, local)).toBe('/home/demo/app')
    expect(repoArgument('/Users/demo/app', laptop, laptop)).toBe('/Users/demo/app')
  })

  it('projet local, dépôt distant : chemin@id Herdr de la machine', () => {
    expect(repoArgument('/Users/demo/app', laptop, local)).toBe('/Users/demo/app@0123abcd0123abcd')
    // Chemin contenant « @ » : herdr-projects coupe au dernier « @ ».
    expect(repoArgument('/Users/demo/a@b', laptop, local)).toBe('/Users/demo/a@b@0123abcd0123abcd')
  })

  it('refuse ce que herdr-projects lirait mal ou ne saurait pas joindre', () => {
    expect(repoArgument('/home/demo/app', local, laptop)).toBeNull()
    expect(repoArgument('/Users/demo/app', other, laptop)).toBeNull()
    expect(repoArgument('/Users/demo/app', { local: false, profileId: null }, local)).toBeNull()
    expect(repoArgument('/Users/demo/app', { local: false, profileId: 'Mac Demo' }, local)).toBeNull()
    expect(repoArgument('/home/demo/app@v2', local, local)).toBeNull()
  })

  it('argv de new avec un dépôt distant ; la machine n’est pas passée telle quelle', () => {
    const input = cleanProjectInput('new', { name: 'App', goal: '', repo: '/Users/demo/app', machine: 'a1b2c3d4' })!
    expect(input).toEqual({ name: 'App', repo: '/Users/demo/app', machine: 'a1b2c3d4' })
    input.repo = repoArgument(input.repo!, laptop, local)!
    expect(projectCommandArgs('new', input, { session: 'default' })).toEqual(['new', 'App', '--repo', '/Users/demo/app@0123abcd0123abcd'])
    expect(cleanProjectInput('new', { name: 'App', machine: 'x'.repeat(65) })).toBeNull()
    expect(cleanProjectInput('new', { name: 'App', repo: '', machine: '' })).toEqual({ name: 'App' })
  })
})
