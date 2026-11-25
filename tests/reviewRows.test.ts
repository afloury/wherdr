import { describe, expect, it } from 'vitest'
import { fileIcon, filePaths, reviewRows, type ReviewRow, type ReviewShots, type TaskFile } from '../shared/pm/reviewRows'
import { reviewItems, type ReviewItem } from '../shared/pm/reviewLinks'
import type { Shot } from '../shared/pm/shots'

const shot = (n: number, phase: Shot['phase'] = 'after'): Shot => ({ file: `${String(n).padStart(12, 'a')}.png`, phase, at: n })
const shots = (list: Shot[], mode: ReviewShots['mode'] = 'after'): ReviewShots => ({ task: 'T-1', shots: list, mode })
const src = (s: Shot) => `/api/pm/shot?task=T-1&file=${s.file}`
const at = (rel: string, root: TaskFile['root'] = 'worktree'): TaskFile => ({ root, rel })
const file = (path: string, source: 'step' | 'report' = 'step'): ReviewItem => ({ kind: 'file', path, label: path.split('/').at(-1)!, source })
const url = (u: string, label: string, source: 'step' | 'report' | 'task' = 'task'): ReviewItem => ({ kind: 'url', url: u, label, source })
const keys = (rows: ReviewRow[]) => rows.map(r => r.key)
const labels = (rows: ReviewRow[]) => rows.map(r => (r.kind === 'shots' ? `shots ${r.count}` : r.label))

describe('the rows of the To review block', () => {
  it('lists what the step names, then the screenshots, then the report, then the task links', () => {
    const items = reviewItems({
      step: ['Read catalogue.md, then approve'],
      report: 'Plan in plan.md, preview at https://preview.example.test/page',
      links: [{ label: 'PR', url: 'https://git.example.test/acme/web/pull/43' }],
    })
    const found = { 'catalogue.md': at('catalogue.md', 'task'), 'plan.md': at('plan.md') }
    const rows = reviewRows({ items, found, shots: shots([shot(1), shot(2)]) })
    expect(labels(rows)).toEqual(['catalogue.md', 'shots 2', 'plan.md', 'preview.example.test/page', 'PR #43'])
    expect(rows.map(r => r.kind)).toEqual(['file', 'shots', 'file', 'url', 'url'])
    // Within a source, the order of the text holds, files and links mixed.
    const one = [url('https://a.example.test/', 'a', 'report'), file('b.md', 'report'), url('https://c.example.test/', 'c', 'report')]
    expect(keys(reviewRows({ items: one, found: { 'b.md': at('b.md') } }))).toEqual(['url:https://a.example.test/', 'file:worktree:b.md', 'url:https://c.example.test/'])
  })

  it('shows every candidate file while the server is asked, and the ones it found after', () => {
    const items = [file('a.md'), url('https://x.example.test/p', 'x.example.test/p', 'step'), file('gone.md', 'report')]
    expect(reviewRows({ items }).map(r => (r.kind === 'file' ? r.at === undefined : r.kind))).toEqual([true, 'url', true])
    const answered = reviewRows({ items, found: { 'a.md': at('a.md') } })
    expect(answered.map(r => r.kind)).toEqual(['file', 'url'])
    expect(answered[0]).toMatchObject({ kind: 'file', at: { root: 'worktree', rel: 'a.md' } })
    // Nothing found: the block may end up empty.
    expect(reviewRows({ items: [file('a.md')], found: {} })).toEqual([])
    // An inherited key of the answer is not a file found.
    expect(reviewRows({ items: [file('constructor')], found: {} })).toEqual([])
  })

  it('lists a file once, whichever way it was written', () => {
    const items = [file('docs/plan.md'), file('/home/user/work/docs/plan.md', 'report'), file('notes.md', 'report')]
    const found = { 'docs/plan.md': at('docs/plan.md'), '/home/user/work/docs/plan.md': at('docs/plan.md'), 'notes.md': at('docs/plan.md', 'task') }
    const rows = reviewRows({ items, found })
    // The same path under the other root is another file.
    expect(keys(rows)).toEqual(['file:worktree:docs/plan.md', 'file:task:docs/plan.md'])
    expect(rows[0]).toMatchObject({ path: 'docs/plan.md', source: 'step' })
  })

  it('leaves out a file that is one of the screenshots shown, which have their row', () => {
    const list = [shot(1), shot(2, 'before')]
    const items = [file(`out/${shot(1).file}`, 'report'), file('home.png', 'report')]
    const rows = reviewRows({ items, found: { 'home.png': at('home.png') }, shots: shots(list) })
    expect(keys(rows)).toEqual(['shots', 'file:worktree:home.png'])
    expect(filePaths(items, shots(list))).toEqual(['home.png'])
    // The same while the server is asked.
    expect(reviewRows({ items, shots: shots(list) }).map(r => r.kind)).toEqual(['shots', 'file'])
    // A shot the mode does not show (a before shot of an after-only step) covers nothing.
    const named = [file(shot(2, 'before').file, 'report')]
    expect(filePaths(named, shots(list))).toEqual([shot(2, 'before').file])
    expect(reviewRows({ items: named, found: { [shot(2, 'before').file]: at('p.png') }, shots: shots([shot(2, 'before')]) }).map(r => r.kind)).toEqual(['file'])
  })

  it('opens the screenshots on the set of the gallery: each row\'s before, then its after', () => {
    const list = [shot(1), shot(2, 'before'), shot(3), shot(4, 'before')]
    const [row] = reviewRows({ items: [], shots: shots(list, 'before-after') })
    expect(row).toMatchObject({ kind: 'shots', count: 4, icon: 'i-lucide-images', srcs: [src(list[1]!), src(list[0]!), src(list[3]!), src(list[2]!)] })
    expect(reviewRows({ items: [], shots: shots([]) })).toEqual([])
    expect(reviewRows({ items: [] })).toEqual([])
  })

  it('tells two files of one name apart by where they are', () => {
    const items = [file('a/plan.md'), file('b/plan.md', 'report'), file('notes.md', 'report')]
    const found = { 'a/plan.md': at('a/plan.md'), 'b/plan.md': at('b/plan.md'), 'notes.md': at('notes.md') }
    expect(labels(reviewRows({ items, found }))).toEqual(['a/plan.md', 'b/plan.md', 'notes.md'])
    // Alone, a file keeps its short name.
    expect(labels(reviewRows({ items: [file('a/plan.md')], found }))).toEqual(['plan.md'])
  })

  it('names the host of a link only when its label does not', () => {
    const rows = reviewRows({
      items: [
        url('https://www.git.example.test/acme/web/pull/43', 'PR #43'),
        url('https://docs.example.test/guide', 'docs.example.test/guide', 'report'),
        url('https://tracker.example.test/T-1', 'The ticket', 'step'),
      ],
    })
    expect(rows.map(r => r.kind === 'url' && [r.label, r.host, r.icon])).toEqual([
      ['The ticket', 'tracker.example.test', 'i-lucide-link'],
      ['docs.example.test/guide', '', 'i-lucide-link'],
      ['PR #43', 'git.example.test', 'i-lucide-git-pull-request'],
    ])
  })

  it('reads a pull request as PR #n, however the text wrote its address', () => {
    const rows = reviewRows({ items: reviewItems({ report: 'Opened https://git.example.test/acme/web/pull/43 for review' }) })
    expect(rows.map(r => r.kind === 'url' && [r.label, r.host])).toEqual([['PR #43', 'git.example.test']])
  })

  it('has an icon for the kind of file', () => {
    const names = ['a.md', 'notes.txt', 'doc.pdf', 'p.png', 'p.svg', 'v.mp4', 'v.webm', 'page.html', 'data.json', 'data.csv', 'Makefile']
    expect(names.map(fileIcon)).toEqual([
      'i-lucide-file-type', 'i-lucide-file-type', 'i-lucide-file-text', 'i-lucide-file-image', 'i-lucide-file-image',
      'i-lucide-video', 'i-lucide-video', 'i-lucide-file-code', 'i-lucide-file-json', 'i-lucide-file-json', 'i-lucide-file-type',
    ])
  })
})
