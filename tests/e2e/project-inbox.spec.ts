import { expect, test, type Page } from '@playwright/test'
import { COORDINATOR_PANE } from './scenario.mjs'

// Project panel › Inbox and Routines tabs: unhandled inbox items with Done
// (POST /api/project/inbox), and the read-only list of routines.
const iso = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000).toISOString()
const board = {
  slug: 'acme',
  version: 'v1',
  lists: [{ title: 'Backlog', kind: 'backlog', tasks: [{ text: 'Export to CSV', done: false, owner: 'agent', thread: null }] }],
  open: [{ id: 't-0040', title: 'Per-key rate limits on the public API', group: 'Ready for review', token: 'ready-for-review', rank: 2, resolved: false, updated: iso(3), created: iso(50), agentName: null, machine: 'Laptop', profile: 'codex', stateLine: 'review · report', activity: 'Done', percent: 100, pr: '', report: true }],
  resolved: [],
}
const ITEMS = [
  { id: '20260101T090000Z-outage-laptop-40', kind: 'outage', subject: 'Laptop', event: 'unreachable', summary: 'Laptop has been unreachable for 10 minutes; its 1 open thread cannot be read', created: iso(95), body: '' },
  { id: '20260101T101500Z-routine-nightly-tests-41', kind: 'routine', subject: 'nightly-tests', event: 'due', summary: 'Routine nightly-tests is due', created: iso(35), body: 'Run the full test suite on main and open a thread for every new failure.\n\nReport the count of failures first, then one line per failing test with its file.\nDo not retry a flaky test more than twice.' },
  { id: '20260101T104800Z-thread-state-t-0040-42', kind: 'thread-state', subject: 't-0040', event: 'new report', summary: 't-0040 "Per-key rate limits on the public API" has a new report: token bucket per key, 9 new tests, 162/162 pass', created: iso(4), body: '' },
]
const ROUTINES = {
  routines: [
    { name: 'nightly-tests', schedule: 'daily 02:30', enabled: true, kind: 'prompt only', when: ['last 2026-01-01 02:30', 'next 2026-01-02 02:30'] },
    { name: 'pr-followup', schedule: 'on pr: checks-failed, review', enabled: true, kind: 'prompt only', when: [] },
    { name: 'stuck-threads', schedule: 'every 15m', enabled: true, kind: 'prompt only', when: ['last 2026-01-01 10:45', 'next 2026-01-01 11:00', '1 run(s) skipped while its item was unhandled'] },
    { name: 'dependency-audit', schedule: 'every 7d', enabled: false, kind: 'command: NOT approved (or edited since approval)', when: ['last 2025-12-28 09:00', 'next - (disabled)'] },
  ],
  broken: [],
}

const shot = async (page: Page, name: string, project: string) => {
  if (!process.env.SHOTS) return
  await page.waitForTimeout(300)
  await page.screenshot({ path: `${process.env.SHOTS}/${project}-${name}.png` })
}

async function openPanel(page: Page, lang = 'en') {
  await page.addInitScript(([pane, l]) => {
    localStorage.setItem('herdrLanguage', String(l))
    localStorage.setItem('viewModes', JSON.stringify({ [String(pane)]: 'project' }))
  }, [COORDINATOR_PANE, lang] as const)
  let items = [...ITEMS]
  const done: string[] = []
  const other: string[] = []
  await page.route('**/api/project?**', route => route.fulfill({ json: board }))
  await page.route('**/api/project/inbox**', (route) => {
    const req = route.request()
    if (req.method() === 'POST') {
      const id = String((req.postDataJSON() as { id: string }).id)
      done.push(id)
      items = items.filter(x => x.id !== id)
      return route.fulfill({ json: { ok: true } })
    }
    return route.fulfill({ json: { items, total: items.length } })
  })
  await page.route('**/api/project/routines**', (route) => {
    if (route.request().method() !== 'GET') other.push(route.request().method())
    return route.fulfill({ json: ROUTINES })
  })
  await page.goto(`/#/a/${COORDINATOR_PANE}`)
  await expect(page.locator('.project-panel .pp-tabs')).toBeVisible()
  return { done, other }
}

test('the Inbox tab lists unhandled items and marks one as handled', async ({ page }, testInfo) => {
  const { done } = await openPanel(page)
  await page.getByRole('tab', { name: /Inbox/ }).click()
  await expect(page.locator('.pi-card')).toHaveCount(3)
  await expect(page.locator('.pi-title')).toHaveText(['Laptop', 'nightly-tests', 'Per-key rate limits on the public API'])
  await expect(page.getByRole('tab', { name: /Inbox/ })).toContainText('3')
  await shot(page, 'inbox-tab', testInfo.project.name)

  // Done buttons are touch-sized, and nothing overflows sideways.
  const box = (await page.locator('.pi-done').first().boundingBox())!
  expect(Math.round(Math.min(box.width, box.height))).toBeGreaterThanOrEqual(44)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)

  // A routine's prompt is folded until tapped.
  const text = page.locator('.pi-text').nth(1)
  await expect(text).toHaveAttribute('aria-expanded', 'false')
  await text.click()
  await expect(text).toHaveAttribute('aria-expanded', 'true')

  await page.getByRole('button', { name: 'Mark as handled: Laptop' }).click()
  await expect(page.locator('.pi-card')).toHaveCount(2)
  expect(done).toEqual(['20260101T090000Z-outage-laptop-40'])
  await expect(page.getByRole('tab', { name: /Inbox/ })).toContainText('2')
})

test('the Routines tab is read-only, in French', async ({ page }, testInfo) => {
  const { other } = await openPanel(page, 'fr')
  await page.getByRole('tab', { name: 'Routines' }).click()
  await expect(page.locator('.pr-card')).toHaveCount(4)
  await expect(page.locator('.pr-card .pill')).toHaveText(['Activée', 'Activée', 'Activée', 'Désactivée'])
  await expect(page.locator('.pr-card').first()).toContainText('next 2026-01-02 02:30')
  await expect(page.locator('.pr button')).toHaveCount(0)
  await shot(page, 'routines-tab-fr', testInfo.project.name)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  expect(other).toEqual([])
})
