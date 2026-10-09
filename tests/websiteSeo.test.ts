import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { REPO } from '../website/app/utils/site'
import { DESCRIPTION, SHARE_IMAGE, SITEMAP_PAGES, SITE_URL, TITLE, sitemapXml, softwareApplication } from '../website/app/utils/seo'

// What search engines read on wherdr.dev: robots.txt, sitemap.xml, the share
// image and the structured data of the home page.
const read = (path: string) => readFileSync(new URL(path, import.meta.url))

describe('robots.txt', () => {
  const robots = read('../website/public/robots.txt').toString()

  it('lets every crawler in and names the sitemap', () => {
    const rules = robots.split('\n').filter(l => l && !l.startsWith('#'))
    expect(rules).toEqual(['User-agent: *', 'Allow: /', `Sitemap: ${SITE_URL}/sitemap.xml`])
  })
})

describe('sitemap.xml', () => {
  it('lists each page with its absolute address and date', () => {
    const xml = sitemapXml([{ path: '/', lastmod: '2026-01-02T03:04:05+00:00' }, { path: '/agent.md', lastmod: '2026-01-03' }])
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">')).toBe(true)
    expect([...xml.matchAll(/<loc>(.*?)<\/loc>\s*<lastmod>(.*?)<\/lastmod>/g)].map(m => [m[1], m[2]])).toEqual([
      ['https://wherdr.dev/', '2026-01-02T03:04:05+00:00'],
      ['https://wherdr.dev/agent.md', '2026-01-03'],
    ])
  })

  it('escapes what XML reserves', () => {
    expect(sitemapXml([{ path: '/?a=1&b=<2>', lastmod: 'x' }])).toContain('<loc>https://wherdr.dev/?a=1&#38;b=&#60;2&#62;</loc>')
  })

  it('names pages that exist, and not the demo, the installer or llms.txt', () => {
    expect(SITEMAP_PAGES.map(p => p.path)).toEqual(['/', '/agent.md'])
    for (const page of SITEMAP_PAGES) {
      for (const source of page.sources) expect(existsSync(new URL(`../website/${source}`, import.meta.url))).toBe(true)
    }
  })
})

describe('link previews and structured data', () => {
  it('share image is the 1200×630 PNG the tags announce', () => {
    const png = read('../website/public/og.png')
    expect(png.subarray(1, 4).toString()).toBe('PNG')
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([SHARE_IMAGE.width, SHARE_IMAGE.height])
    expect(SHARE_IMAGE.url).toBe(`${SITE_URL}/og.png`)
  })

  it('title and description fit a search result', () => {
    expect(TITLE.length).toBeLessThanOrEqual(70)
    expect(DESCRIPTION.length).toBeLessThanOrEqual(200)
  })

  it('describes wherdr as a free, MIT-licensed application', () => {
    const app = softwareApplication()
    expect(app).toMatchObject({
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
      'name': 'wherdr',
      'description': DESCRIPTION,
      'url': 'https://wherdr.dev/',
      'license': 'https://opensource.org/licenses/MIT',
      'installUrl': 'https://wherdr.dev/install',
      'sameAs': [REPO],
    })
    // Plain data: it is inlined in the page as JSON.
    expect(JSON.parse(JSON.stringify(app))).toEqual(app)
  })
})
