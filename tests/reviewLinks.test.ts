import { describe, expect, it } from 'vitest'
import { reviewItems, type ReviewItem } from '../shared/pm/reviewLinks'

const paths = (items: ReviewItem[]) => items.map(i => i.kind === 'file' ? i.path : i.url)

describe('reviewItems', () => {
  it('finds nothing in nothing', () => {
    expect(reviewItems({})).toEqual([])
    expect(reviewItems({ step: ['', 'No artifacts here.'], report: 'Done.' })).toEqual([])
  })

  it('extracts markdown links, backtick spans and bare names in order of appearance', () => {
    const items = reviewItems({ step: ['Read [the plan](docs/plan.md), then `catalogue.md` and shots/home.png; see [PR](https://github.com/o/r/pull/12).'] })
    expect(items).toEqual([
      { kind: 'file', path: 'docs/plan.md', label: 'plan.md', source: 'step' },
      { kind: 'file', path: 'catalogue.md', label: 'catalogue.md', source: 'step' },
      { kind: 'file', path: 'shots/home.png', label: 'home.png', source: 'step' },
      { kind: 'url', url: 'https://github.com/o/r/pull/12', label: 'PR', source: 'step' },
    ])
  })

  it('trims the punctuation of the sentence around a url or a name', () => {
    const items = reviewItems({ report: 'Open https://example.com/a/b, (https://example.com/c) or https://example.com/d. Then plan.md. Also (notes.txt); done: out.json:' })
    expect(paths(items)).toEqual(['https://example.com/a/b', 'https://example.com/c', 'https://example.com/d', 'plan.md', 'notes.txt', 'out.json'])
  })

  it('keeps a closing bracket the url opened', () => {
    expect(paths(reviewItems({ report: 'https://en.wikipedia.org/wiki/Foo_(bar).' }))).toEqual(['https://en.wikipedia.org/wiki/Foo_(bar)'])
  })

  it('does not read a file name inside a url', () => {
    const items = reviewItems({ step: ['https://example.com/docs/readme.md and [x](https://example.com/y/z.pdf)'] })
    expect(items.map(i => i.kind)).toEqual(['url', 'url'])
  })

  it('rejects version numbers, bare domains and parent paths', () => {
    const text = 'Bumped to v3.2.2 and 1.4.0, see example.com, github.com/o/r/page.html, ../secret.md, docs/../x.md, `.md`, notes.docx, a//b.md'
    expect(reviewItems({ step: [text] })).toEqual([])
  })

  it('accepts absolute paths and an extension in any case, and drops fragments and line numbers', () => {
    const items = reviewItems({ report: 'Wrote /tmp/out/Report.PDF and ./docs/a.md#top, also src/b.json:12:3' })
    expect(paths(items)).toEqual(['/tmp/out/Report.PDF', 'docs/a.md', 'src/b.json'])
  })

  it('treats docs/x.md and ./docs/x.md as the same file, and a url once', () => {
    const items = reviewItems({
      step: ['docs/x.md and ./docs/x.md and https://example.com/p/#a'],
      report: 'again `docs/x.md` https://example.com/p',
    })
    expect(paths(items)).toEqual(['docs/x.md', 'https://example.com/p/#a'])
  })

  it('ranks the step before the report before the task links', () => {
    const items = reviewItems({
      report: 'Report: summary.md and https://example.com/report',
      step: ['Check https://example.com/step', 'plan.md'],
      links: [
        { label: 'Docs', url: 'https://example.com/docs/guide' },
        { label: 'dup', url: 'https://example.com/report' },
      ],
    })
    expect(items.map(i => `${i.source}:${i.kind === 'file' ? i.path : i.url}`)).toEqual([
      'step:https://example.com/step',
      'step:plan.md',
      'report:summary.md',
      'report:https://example.com/report',
      'task:https://example.com/docs/guide',
    ])
  })

  it('drops a report url a higher-ranked source already had', () => {
    const items = reviewItems({ step: ['https://example.com/a'], report: 'https://example.com/a', links: [{ label: 'A', url: 'https://example.com/a' }] })
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ source: 'step' })
  })

  it('labels urls by markdown text, else host and last segment, trimmed', () => {
    const items = reviewItems({
      step: ['[Design](https://figma.com/file/abc) https://www.example.com/a/very-long-page-name-that-keeps-going-and-going https://example.com/ [https://x.test/y](https://x.test/y)'],
    })
    expect(items.map(i => i.label)).toEqual(['Design', 'example.com/very-long-page-name-that-ke…', 'example.com', 'x.test/y'])
    expect(items[1]!.label).toHaveLength(40)
  })

  it('labels task links by their label, PRs as PR #n, else host and page', () => {
    const items = reviewItems({ links: [
      { label: 'Preview', url: 'https://preview.example.com/' },
      { label: 'PR', url: 'https://github.com/o/r/pull/12' },
      { label: '', url: 'https://example.com/a/b' },
      { label: 'file', url: 'ftp://example.com/x' },
    ] })
    expect(items).toEqual([
      { kind: 'url', url: 'https://preview.example.com/', label: 'Preview', source: 'task' },
      { kind: 'url', url: 'https://github.com/o/r/pull/12', label: 'PR #12', source: 'task' },
      { kind: 'url', url: 'https://example.com/a/b', label: 'example.com/b', source: 'task' },
    ])
  })

  it('reads markdown images as files and decodes encoded names', () => {
    const items = reviewItems({ step: ['![shot](img/home%20page.png "Home")'] })
    expect(items).toEqual([{ kind: 'file', path: 'img/home page.png', label: 'home page.png', source: 'step' }])
  })
})
