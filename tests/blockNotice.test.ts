import { describe, expect, it } from 'vitest'
import { blockChoices, blockKind, linkLabel, offersAlways, prLink, shortText, textParts } from '../app/utils/blockNotice'

describe('blockKind', () => {
  it('knows the three kinds of wait and nothing else', () => {
    expect(['question', 'permission', 'auth', '', 'other', undefined].map(blockKind)).toEqual(['question', 'permission', 'auth', null, null, null])
  })
})

describe('links', () => {
  it('names a pull request by its number, other links by host and path end', () => {
    expect(linkLabel('https://github.com/acme/app/pull/484')).toBe('PR #484')
    expect(linkLabel('https://github.com/acme/app/pull/484/files')).toBe('PR #484')
    expect(linkLabel('https://example.com/docs/setup/install')).toBe('example.com/…/setup/install')
    expect(linkLabel('https://example.com/')).toBe('example.com')
  })
  it('splits text around its links, leaving closing punctuation to the sentence', () => {
    expect(textParts('Merged in https://github.com/acme/app/pull/12. Done')).toEqual([
      { text: 'Merged in ' },
      { text: 'PR #12', href: 'https://github.com/acme/app/pull/12' },
      { text: '. Done' },
    ])
    expect(textParts('(see https://example.com/a)')).toEqual([
      { text: '(see ' }, { text: 'example.com/a', href: 'https://example.com/a' }, { text: ')' },
    ])
    expect(textParts('no link here')).toEqual([{ text: 'no link here' }])
  })
  it('keeps a card line on one line with short links', () => {
    expect(shortText('Review\nhttps://github.com/acme/app/pull/7  please')).toBe('Review PR #7 please')
  })
  it('finds the first pull request a message links to', () => {
    expect(prLink('See https://example.com/x and https://github.com/acme/app/pull/9.')).toBe('https://github.com/acme/app/pull/9')
    expect(prLink('nothing')).toBe('')
  })
})

describe('blockChoices', () => {
  it('reads a closing group of answers', () => {
    expect(blockChoices('Remove the old settings file? (yes/no)').map(c => c.reply)).toEqual(['yes', 'no'])
    expect(blockChoices('Which store? [Postgres | SQLite | keep files]').map(c => c.label)).toEqual(['Postgres', 'SQLite', 'keep files'])
    expect(blockChoices('Rebase or close? (rebase on v2 or close it)').map(c => c.label)).toEqual(['rebase on v2', 'close it'])
  })
  it('reads numbered or lettered answers, inline or one per line', () => {
    expect(blockChoices('Which way? 1) keep the old API, 2) drop it')).toEqual([
      { label: 'keep the old API', reply: '1) keep the old API' },
      { label: 'drop it', reply: '2) drop it' },
    ])
    expect(blockChoices('Pick one:\nA. Rename the tab\nB. Close it').map(c => c.reply)).toEqual(['A) Rename the tab', 'B) Close it'])
  })
  it('offers nothing when the agent formulated no answers', () => {
    expect(blockChoices('Should the old settings file be removed')).toEqual([])
    expect(blockChoices('Where should it go (src/app.ts)?')).toEqual([])
    expect(blockChoices('Is this fine (e.g. foo/bar)?')).toEqual([])
    expect(blockChoices('See (https://example.com/a/b)')).toEqual([])
    expect(blockChoices('Only 1) one option here')).toEqual([])
  })
})

describe('offersAlways', () => {
  it('sees an offer to allow for good, in English or French', () => {
    expect(offersAlways('Run npm publish? (yes / always / no)')).toBe(true)
    expect(offersAlways('Lancer le script ? Toujours autoriser possible')).toBe(true)
    expect(offersAlways('Delete the test data?')).toBe(false)
  })
})
