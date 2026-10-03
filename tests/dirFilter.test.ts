import { describe, expect, it } from 'vitest'
import { filterByName, folderLabels, projectFolderHint } from '../app/utils/dirFilter'

const id = (s: string) => s

describe('filterByName', () => {
  it('keeps every item, in order, for an empty or blank query', () => {
    const dirs = ['wherdr', 'acme', 'app']
    expect(filterByName(dirs, '', id)).toEqual(dirs)
    expect(filterByName(dirs, '   ', id)).toEqual(dirs)
  })

  it('matches anywhere in the name, ignoring case and accents', () => {
    expect(filterByName(['Été-notes', 'wherdr', 'acme-portal'], 'ETE', id)).toEqual(['Été-notes'])
    expect(filterByName(['Été-notes', 'wherdr', 'acme-portal'], 'portal', id)).toEqual(['acme-portal'])
    expect(filterByName(['wherdr'], 'xyz', id)).toEqual([])
  })

  it('puts names starting with the query first, each group in its original order', () => {
    const recents = ['identity-sass-service', 'acme-portal', 'mortgagepedia', 'acme', 'portal-acme']
    expect(filterByName(recents, 'acme', id)).toEqual(['acme-portal', 'acme', 'portal-acme'])
    expect(filterByName(recents, 'port', id)).toEqual(['portal-acme', 'acme-portal'])
  })

  it('matches on the name only, not the rest of the item', () => {
    const dirs = [{ name: 'app', path: '/home/demo/acme/app' }, { name: 'acme', path: '/home/demo/acme' }]
    expect(filterByName(dirs, 'acme', d => d.name)).toEqual([dirs[1]])
  })
})

describe('folderLabels', () => {
  it('names a folder by its last segment, home as ~', () => {
    expect(folderLabels(['~/Projects/acme/acme-portal', '~/wherdr', '~'])).toEqual(['acme-portal', 'wherdr', '~'])
  })

  it('adds the parent folder to names shared by several folders', () => {
    const dirs = ['~/Projects/acme/kyc-service', '~/wherdr', '~/Projects/acme-cap3-worktrees/kyc-service']
    expect(folderLabels(dirs)).toEqual(['acme/kyc-service', 'wherdr', 'acme-cap3-worktrees/kyc-service'])
  })

  it('suffixes a herdr-projects project folder that shares its name with its repository', () => {
    const dirs = ['~/.herdr-projects/acme', '~/code/acme', '~/notes']
    expect(folderLabels(dirs, ['project', undefined, undefined])).toEqual(['acme · project', 'acme', 'notes'])
    expect(folderLabels(dirs, ['project'], ' · projet')[0]).toBe('acme · projet')
  })

  it('leaves a project folder with a unique name as is', () => {
    expect(folderLabels(['~/.herdr-projects/acme', '~/code/portal'], ['project'])).toEqual(['acme', 'portal'])
  })

  it('still adds the parent within each group of same-named folders', () => {
    const dirs = ['~/.herdr-projects/acme', '~/code/acme', '~/wt/acme', '~/other-root/acme']
    expect(folderLabels(dirs, ['project', undefined, undefined, 'project']))
      .toEqual(['.herdr-projects/acme · project', 'code/acme', 'wt/acme', 'other-root/acme · project'])
  })

  it('does not suffix thread folders', () => {
    expect(folderLabels(['~/.herdr-projects/acme/threads/t-0001', '~/x/t-0001'], ['thread'])).toEqual(['threads/t-0001', 'x/t-0001'])
  })
})

describe('projectFolderHint', () => {
  it('says the folder is not the repository', () => {
    expect(projectFolderHint('project')).toMatch(/project folder \(coordinator\) — not the repository|pas le dépôt/)
    expect(projectFolderHint('thread')).toMatch(/thread folder — not the repository|pas le dépôt/)
  })
})