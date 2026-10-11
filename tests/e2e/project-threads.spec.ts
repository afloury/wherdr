import { expect, test, type Page } from '@playwright/test'
import { COORDINATOR_PANE } from './scenario.mjs'

// Project panel › Threads tab: every thread of the project, a thread's record
// (`thread show`) and its actions, run through POST /api/project/thread.
const iso = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000).toISOString()
const thread = (id: string, title: string, over: Record<string, unknown> = {}) => ({
  id, title, group: 'Working', token: 'working', rank: 4, resolved: false, updated: iso(3), created: iso(50),
  agentName: null, machine: '', profile: 'claude', stateLine: 'working · ~60%', activity: 'Writing tests', percent: 60, pr: '', report: false, ...over,
})
const resolved = (n: number, title: string, over: Record<string, unknown> = {}) => thread(`t-${String(n).padStart(4, '0')}`, title, {
  group: 'Resolved', token: 'resolved', rank: 6, resolved: true, stateLine: 'review · report', activity: '', percent: 100, report: true, updated: iso(60 * (40 - n)), ...over,
})
const OLD = ['Webhook retries with backoff', 'Paginate the invoices endpoint', 'Dead-letter list in the dashboard', 'Audit log export', 'Idempotency keys on payments', 'Health endpoint', 'Structured request logs', 'Tenant-scoped API keys']
const board = {
  slug: 'acme',
  version: 'v1',
  slots: { used: 3, max: 3 },
  lists: [
    { title: 'To test', kind: 'test', tasks: [{ text: 'Webhook retries with backoff', done: false, owner: 'me', thread: null }] },
    { title: 'Backlog', kind: 'backlog', tasks: [{ text: 'Export to CSV', done: false, owner: 'agent', thread: null }] },
  ],
  open: [
    thread('t-0041', 'Fix the flaky CSV export test', { group: 'Waiting on you', token: 'waiting-on-you', rank: 1, stateLine: 'needs you · ~70%', activity: 'Waiting for approval', percent: 70, profile: 'omp' }),
    thread('t-0040', 'Per-key rate limits on the public API', { group: 'Ready for review', token: 'ready-for-review', rank: 2, stateLine: 'review · report', activity: 'Done', percent: 100, report: true, profile: 'codex', machine: 'Laptop', pr: 'https://github.com/owner/repo/pull/12' }),
    thread('t-0042', 'OpenAPI spec for the v2 endpoints'),
  ],
  resolved: Array.from({ length: 34 }, (_, i) => resolved(39 - i, OLD[i % OLD.length]!, { profile: ['claude', 'codex', 'omp'][i % 3] })),
}
const record = (id: string, acked: boolean) => {
  const th = [...board.open, ...board.resolved].find(x => x.id === id)!
  return { thread: {
    ...th, note: '', error: '', kind: 'worktree', agent: th.profile, branch: `hp/acme/${id}-work`, base: 'origin/main',
    prState: th.pr ? 'open' : '', prReview: th.pr ? 'review required' : '',
    next: th.report && !th.resolved ? ['Merge the pull request', 'Add a Redis store before running several instances', 'Remove the worktree and branch'] : [],
    acked: th.resolved || acked, hasPane: !th.resolved, keptWorktree: false, resolvedReason: th.resolved ? 'manual' : '',
  } }
}

// Screenshots wait for the sheet's opening animation.
const shot = async (page: Page, name: string, project: string) => {
  if (!process.env.SHOTS) return
  await page.waitForTimeout(450)
  await page.screenshot({ path: `${process.env.SHOTS}/${project}-${name}.png` })
}

async function openThreads(page: Page, lang = 'en') {
  await page.addInitScript(([pane, l]) => {
    localStorage.setItem('herdrLanguage', String(l))
    // The phone shows the panel as a tab of the coordinator.
    localStorage.setItem('viewModes', JSON.stringify({ [String(pane)]: 'project' }))
  }, [COORDINATOR_PANE, lang] as const)
  const actions: { id: string, action: string }[] = []
  await page.route('**/api/project?**', route => route.fulfill({ json: board }))
  await page.route('**/api/project/thread**', (route) => {
    const req = route.request()
    if (req.method() === 'POST') {
      const body = req.postDataJSON() as { id: string, action: string }
      actions.push({ id: body.id, action: body.action })
      return route.fulfill({ json: { output: body.action === 'resolve' ? `${body.id} resolved; its report and library are kept.\n  - worktree removed\n  - tab closed` : `${body.id}: report acknowledged` } })
    }
    const id = new URL(req.url()).searchParams.get('id')!
    return route.fulfill({ json: record(id, actions.some(a => a.id === id && a.action === 'ack')) })
  })
  await page.goto(`/#/a/${COORDINATOR_PANE}`)
  await expect(page.locator('.project-panel .pp-tabs')).toBeVisible()
  await page.getByRole('tab', { name: /Threads/ }).click()
  await expect(page.locator('.pt-group-head').first()).toBeVisible()
  return actions
}

test('the Threads tab lists open threads by group and keeps resolved ones folded', async ({ page }, testInfo) => {
  await openThreads(page)
  await expect(page.locator('.pt-group-head .pill')).toHaveText(['Your turn', 'Ready for review', 'Working'])
  await expect(page.locator('.pt-group .pp-meta').nth(1)).toContainText('T-0040 · Laptop · codex')
  const head = page.locator('.pt-resolved .pp-sec-head')
  await expect(head).toHaveAttribute('aria-expanded', 'false')
  await expect(page.locator('.pt-resolved .pp-row')).toHaveCount(0)
  await shot(page, 'threads-tab', testInfo.project.name)

  await head.click()
  await expect(page.locator('.pt-resolved .pp-row')).toHaveCount(30)
  await page.locator('.pt-filter input').fill('audit')
  await expect(page.locator('.pt-group')).toHaveCount(0)
  await expect(page.locator('.pt-resolved .pp-thread-title').first()).toHaveText('Audit log export')
  await shot(page, 'threads-filter', testInfo.project.name)

  // Nothing overflows the panel sideways.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  // Back on Tasks, the lists are still there.
  await page.getByRole('tab', { name: 'Tasks' }).click()
  await expect(page.locator('.project-panel')).toContainText('Export to CSV')
})

test('a thread’s record shows its Next list; Acknowledge is sent at once, Resolve asks first', async ({ page }, testInfo) => {
  const actions = await openThreads(page)
  await page.getByRole('button', { name: 'Thread t-0040: Per-key rate limits on the public API' }).click()
  const sheet = page.locator('.hw-sheet').first()
  await expect(sheet.locator('.pt-next li')).toHaveText(['1Merge the pull request', '2Add a Redis store before running several instances', '3Remove the worktree and branch'])
  await expect(sheet.locator('.pt-actions button')).toHaveText(['Acknowledge', 'Restart', 'Resolve'])
  await expect(sheet.getByRole('link', { name: 'Pull request' })).toHaveAttribute('href', 'https://github.com/owner/repo/pull/12')
  await shot(page, 'thread-record', testInfo.project.name)

  // Touch targets of the actions are at least 44 px high.
  for (const b of await sheet.locator('.pt-actions button').all()) expect((await b.boundingBox())!.height).toBeGreaterThanOrEqual(44)

  await sheet.getByRole('button', { name: 'Acknowledge' }).click()
  await expect.poll(() => actions).toEqual([{ id: 't-0040', action: 'ack' }])
  await expect(sheet.locator('.pt-actions button')).toHaveText(['Restart', 'Resolve'])

  await sheet.getByRole('button', { name: 'Resolve' }).click()
  const confirm = page.locator('.confirm')
  await expect(confirm).toContainText('Resolve T-0040?')
  // The confirmation is painted above the record it was asked from.
  const z = (sel: string) => page.locator(sel).evaluate(el => Number(getComputedStyle(el).zIndex))
  expect(await z('.hw-sheet:has(.confirm)')).toBeGreaterThan(await z('.hw-sheet:has(.pt-detail)'))
  await shot(page, 'thread-resolve-confirm', testInfo.project.name)
  await confirm.getByRole('button', { name: 'Cancel' }).click()
  await expect(confirm).toHaveCount(0)
  expect(actions).toHaveLength(1)

  await sheet.getByRole('button', { name: 'Resolve' }).click()
  await page.locator('.confirm').getByRole('button', { name: 'Resolve' }).click()
  await expect.poll(() => actions.at(-1)).toEqual({ id: 't-0040', action: 'resolve' })
  await expect(sheet.locator('.pt-output')).toContainText('worktree removed')
})

test('Stop asks first too, in French', async ({ page }, testInfo) => {
  const actions = await openThreads(page, 'fr')
  await page.getByRole('button', { name: 'Thread t-0042 : OpenAPI spec for the v2 endpoints' }).click()
  const sheet = page.locator('.hw-sheet').first()
  await expect(sheet.locator('.pt-actions button')).toHaveText(['Arrêter', 'Clôturer'])
  await sheet.getByRole('button', { name: 'Arrêter' }).click()
  await expect(page.locator('.confirm')).toContainText('Arrêter T-0042 ?')
  await shot(page, 'thread-stop-confirm-fr', testInfo.project.name)
  await page.locator('.confirm').getByRole('button', { name: 'Annuler' }).click()
  expect(actions).toEqual([])
})
