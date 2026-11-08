import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { docAnchors } from '../scripts/check-doc-links.mjs'

// docs/llms.txt is the index an agent reads first: every link must lead to an
// existing page and heading, and every page must be listed.
const root = fileURLToPath(new URL('../', import.meta.url))
const index = readFileSync(`${root}docs/llms.txt`, 'utf8')
const links = [...index.matchAll(/\]\(([^)]+)\)/g)].map(m => m[1]!)
// Release notes are left out on purpose: the documentation home lists them.
const unlisted = (page: string) => /^release-notes-/.test(page)

describe('docs/llms.txt', () => {
  it('stays small', () => {
    expect(index.split('\n').length).toBeLessThan(150)
  })

  it.each(links)('%s leads to a page and a heading', (link) => {
    const [path, anchor] = link.split('#')
    expect(path).toMatch(/^docs\/[\w.-]+\.md$/)
    expect(existsSync(`${root}${path}`)).toBe(true)
    if (anchor) expect([...docAnchors(`${root}${path}`)]).toContain(anchor)
  })

  it('lists every documentation page', () => {
    const pages = readdirSync(`${root}docs`).filter(f => f.endsWith('.md') && !unlisted(f))
    const listed = new Set(links.map(l => l.split('#')[0]!.slice('docs/'.length)))
    expect(pages.filter(p => !listed.has(p))).toEqual([])
  })
})

// A "Needs:" line names the section to read first: it must exist too.
describe('Needs: lines', () => {
  const pages = readdirSync(`${root}docs`).filter(f => f.endsWith('.md'))
  const needs = pages.flatMap(page => [...readFileSync(`${root}docs/${page}`, 'utf8').matchAll(/^Needs: \[[^\]]+\]\(([^)]*)\)/gm)]
    .map(m => [page, m[1]!] as const))
  it.each(needs)('%s needs %s', (page, link) => {
    const [path, anchor] = link.split('#')
    expect([...docAnchors(`${root}docs/${path || page}`)]).toContain(anchor)
  })
})
