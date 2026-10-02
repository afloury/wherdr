import { describe, expect, it } from 'vitest'
import { filterByName, folderLabels } from '../app/utils/dirFilter'

const id = (s: string) => s

describe('filterByName', () => {
  it('keeps every item, in order, for an empty or blank query', () => {
    const dirs = ['wherdr', 'sniip', 'app']
    expect(filterByName(dirs, '', id)).toEqual(dirs)
    expect(filterByName(dirs, '   ', id)).toEqual(dirs)
  })

  it('matches anywhere in the name, ignoring case and accents', () => {
    expect(filterByName(['Été-notes', 'wherdr', 'sniip-portal'], 'ETE', id)).toEqual(['Été-notes'])
    expect(filterByName(['Été-notes', 'wherdr', 'sniip-portal'], 'portal', id)).toEqual(['sniip-portal'])
    expect(filterByName(['wherdr'], 'xyz', id)).toEqual([])
  })

  it('puts names starting with the query first, each group in its original order', () => {
    const recents = ['identity-sass-service', 'sniip-portal', 'mortgagepedia', 'sniip', 'portal-sniip']
    expect(filterByName(recents, 'sniip', id)).toEqual(['sniip-portal', 'sniip', 'portal-sniip'])
    expect(filterByName(recents, 'port', id)).toEqual(['portal-sniip', 'sniip-portal'])
  })

  it('matches on the name only, not the rest of the item', () => {
    const dirs = [{ name: 'app', path: '/home/demo/sniip/app' }, { name: 'sniip', path: '/home/demo/sniip' }]
    expect(filterByName(dirs, 'sniip', d => d.name)).toEqual([dirs[1]])
  })
})

describe('folderLabels', () => {
  it('names a folder by its last segment, home as ~', () => {
    expect(folderLabels(['~/Projects/sniip/sniip-portal', '~/wherdr', '~'])).toEqual(['sniip-portal', 'wherdr', '~'])
  })

  it('adds the parent folder to names shared by several folders', () => {
    const dirs = ['~/Projects/sniip/kyc-service', '~/wherdr', '~/Projects/sniip-cap3-worktrees/kyc-service']
    expect(folderLabels(dirs)).toEqual(['sniip/kyc-service', 'wherdr', 'sniip-cap3-worktrees/kyc-service'])
  })
})