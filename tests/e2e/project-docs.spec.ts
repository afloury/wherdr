import { expect, test, type Page } from '@playwright/test'
import { COORDINATOR_PANE } from './scenario.mjs'

// Project panel › Settings and Memory tabs, both read-only, and the tab bar
// with six tabs: it scrolls sideways on a phone, a fade showing there is more.
const board = { slug: 'acme', version: 'v1', lists: [{ title: 'Backlog', kind: 'backlog', tasks: [{ text: 'Export to CSV', done: false, owner: 'agent', thread: null }] }], open: [], resolved: [] }
const SETTINGS = { settings: {
  name: 'Acme API', goal: 'Ship the public API v2: rate limits, webhooks and a clean OpenAPI spec.',
  coordinatorProfile: 'claude', threadProfile: 'codex', maxParallelThreads: 3, autoResolveDays: 7, nudge: true, mute: false,
  repos: [{ path: '/srv/code/acme-api', machine: '' }, { path: '/Users/demo/code/acme-web', machine: 'Laptop' }],
  defaults: ['autoResolveDays', 'nudge', 'mute'],
} }
const FILES = { files: [
  { name: 'MEMORY.md', title: 'MEMORY.md', hook: '', index: true },
  { name: 'release.md', title: 'Release checklist', hook: 'what to check before tagging a version' },
  { name: 'rate-limits.md', title: 'Rate limit decisions', hook: '429 with Retry-After, limits per API key' },
  { name: 'deploy.md', title: 'Deploys', hook: 'never from the shared working folder; a clean copy of the commit' },
  { name: 'scratch-notes.md', title: 'scratch-notes.md', hook: '' },
] }
const TEXT = '# Release checklist\n\nBefore tagging a version:\n\n1. `npm test` green on `main`.\n2. Changelog entry under **Unreleased**.\n3. Tag `vX.Y.Z`, then watch the publish workflow.\n\n| Step | Who |\n| --- | --- |\n| Tag | coordinator |\n| Announce | you |\n\n```sh\nnpm version patch\n```\n\n<script>window.hacked = 1</script>\n\n<img src="x" onerror="window.hacked = 2">\n'

const shot = async (page: Page, name: string, project: string) => {
  if (!process.env.SHOTS) return
  await page.waitForTimeout(450)
  await page.screenshot({ path: `${process.env.SHOTS}/${project}-${name}.png` })
}

async function openPanel(page: Page, lang = 'en') {
  await page.addInitScript(([pane, l]) => {
    localStorage.setItem('herdrLanguage', String(l))
    localStorage.setItem('viewModes', JSON.stringify({ [String(pane)]: 'project' }))
  }, [COORDINATOR_PANE, lang] as const)
  const writes: string[] = []
  const asked: string[] = []
  page.on('request', (r) => {
    if (r.method() !== 'GET' && /\/api\/project\//.test(new URL(r.url()).pathname)) writes.push(`${r.method()} ${new URL(r.url()).pathname}`)
  })
  await page.route('**/api/project?**', route => route.fulfill({ json: board }))
  await page.route('**/api/project/inbox**', route => route.fulfill({ json: { items: [], total: 0 } }))
  await page.route('**/api/project/routines**', route => route.fulfill({ json: { routines: [], broken: [] } }))
  await page.route('**/api/project/settings**', route => route.fulfill({ json: SETTINGS }))
  await page.route('**/api/project/memory**', (route) => {
    const name = new URL(route.request().url()).searchParams.get('name')
    if (name === null) return route.fulfill({ json: FILES })
    asked.push(name)
    return route.fulfill({ json: { name, text: TEXT, truncated: false } })
  })
  await page.goto(`/#/a/${COORDINATOR_PANE}`)
  await expect(page.locator('.project-panel .pp-tabs')).toBeVisible()
  return { writes, asked }
}
const tabs = (page: Page) => page.locator('.pp-tabs').getByRole('tab')

test('six tabs: the bar scrolls sideways on a phone, never the page', async ({ page }, testInfo) => {
  await openPanel(page)
  await expect(tabs(page)).toHaveText([/Tasks/, /Threads/, /Inbox/, /Routines/, /Settings/, /Memory/])
  const bar = page.locator('.pp-tabs')
  const overflows = await bar.evaluate(el => el.scrollWidth > el.clientWidth + 2)
  if (testInfo.project.name.includes('phone')) {
    expect(overflows).toBe(true)
    // More tabs to the right: that edge fades, the left one does not.
    await expect(page.locator('.pp-tabs-wrap')).toHaveClass(/more-right/)
    await expect(page.locator('.pp-tabs-wrap')).not.toHaveClass(/more-left/)
    await shot(page, 'six-tabs-start', testInfo.project.name)
  }
  // The last tab is reachable: picking it brings it fully into view.
  await tabs(page).last().click()
  await expect(tabs(page).last()).toHaveAttribute('aria-selected', 'true')
  await expect(tabs(page).last()).toBeInViewport({ ratio: 0.95 })
  if (overflows) await expect(page.locator('.pp-tabs-wrap')).toHaveClass(/more-left/)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  // Every tab is tall enough for a finger.
  for (const t of await tabs(page).all()) expect(Math.round((await t.boundingBox())!.height)).toBeGreaterThanOrEqual(40)
})

test('the Settings tab shows the project’s settings, read-only', async ({ page }, testInfo) => {
  const { writes } = await openPanel(page)
  await tabs(page).filter({ hasText: 'Settings' }).click()
  await expect(page.locator('.ps-row')).toHaveCount(8)
  await expect(page.locator('.ps-row').nth(4)).toContainText('max_parallel_threads')
  await expect(page.locator('.ps-row').nth(4).locator('dd')).toHaveText('3')
  await expect(page.locator('.ps-row').nth(5).locator('dd')).toContainText('7 days')
  await expect(page.locator('.ps-row').nth(5).locator('.ps-default')).toHaveText('default')
  await expect(page.locator('.ps-repos li')).toHaveCount(2)
  await expect(page.locator('.ps button, .ps input, .ps select, .ps textarea')).toHaveCount(0)
  await shot(page, 'settings-tab', testInfo.project.name)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  expect(writes).toEqual([])
})

test('the Memory tab lists the files and shows one as Markdown, in French', async ({ page }, testInfo) => {
  const { writes, asked } = await openPanel(page, 'fr')
  await tabs(page).filter({ hasText: 'Mémoire' }).click()
  await expect(page.locator('.pm-card')).toHaveCount(5)
  await expect(page.locator('.pm-card .pp-thread-title')).toHaveText(['Index', 'Release checklist', 'Rate limit decisions', 'Deploys', 'scratch-notes.md'])
  await shot(page, 'memory-tab-fr', testInfo.project.name)
  await page.getByRole('button', { name: 'Mémoire : Release checklist' }).click()
  const doc = page.locator('.pm-doc')
  await expect(doc.locator('h1')).toHaveText('Release checklist')
  await expect(doc.locator('ol li')).toHaveCount(3)
  await expect(doc.locator('table')).toBeVisible()
  await expect(doc.locator('.pm-path')).toHaveText('memory/release.md')
  // A memory file cannot run code in the app: its raw HTML is sanitized.
  await expect(doc.locator('script')).toHaveCount(0)
  await expect(doc.locator('[onerror]')).toHaveCount(0)
  await page.waitForTimeout(200)
  expect(await page.evaluate(() => (window as unknown as { hacked?: number }).hacked)).toBeUndefined()
  await shot(page, 'memory-file-fr', testInfo.project.name)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  expect(asked).toEqual(['release.md'])
  expect(writes).toEqual([])
})
