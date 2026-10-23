import fs from 'node:fs/promises'
import { test, expect, type Page } from './test'
import { BASE_URL } from './scenario.mjs'

const policy = {
  defaults: [], muteSubagents: true, rules: [
    { scope: 'machine', machine: '', id: '', label: 'Development', mode: 'muted', events: [], until: null },
    { scope: 'project', machine: '', id: 'example', label: 'Example', mode: 'muted', events: [], until: Date.now() + 3600000 },
    { scope: 'conversation', machine: '', id: 'w1:p1', label: 'Main coordinator', mode: 'on', events: ['needs-you', 'finished'], until: null },
  ],
}
const stored = async (page: Page) => {
  const r = await (await page.request.get('/api/settings')).json()
  return r.settings.notificationRules ? JSON.parse(r.settings.notificationRules) : null
}
const seed = async (page: Page) => {
  await page.request.post('/api/settings', { headers: { Origin: BASE_URL }, data: { settings: { notificationRules: JSON.stringify(policy) } } })
}

test('notification rules sync, select events independently, inherit and reset', async ({ page, browser }) => {
  await seed(page)
  await page.goto('/#/settings?section=notifications')
  const rules = page.getByTestId('notification-rules')
  await expect(rules).toBeVisible()
  await expect(rules.locator('.notification-rule')).toHaveCount(3)
  await expect(rules.getByRole('checkbox', { name: 'Needs you', exact: true })).toBeChecked()
  await rules.getByRole('checkbox', { name: 'New message', exact: true }).check()
  await expect.poll(async () => (await stored(page))?.rules[2].events).toContain('message')

  const other = await browser.newContext({ baseURL: BASE_URL, viewport: page.viewportSize(), serviceWorkers: 'block' })
  try {
    const b = await other.newPage()
    await b.goto('/#/settings?section=notifications')
    const second = b.getByTestId('notification-rules')
    await expect(second.getByRole('checkbox', { name: 'New message', exact: true })).toBeChecked()
    await rules.getByRole('checkbox', { name: 'Scheduled task', exact: true }).check()
    await expect(second.getByRole('checkbox', { name: 'Scheduled task', exact: true })).toBeChecked()
    await second.getByRole('combobox', { name: 'Notifications: Example', exact: true }).selectOption('inherit')
    await expect(rules.locator('.notification-rule')).toHaveCount(2)
    await rules.getByRole('button', { name: 'Reset notification rules', exact: true }).click()
    await expect(second.locator('.notification-rule')).toHaveCount(0)
    await expect.poll(async () => (await stored(page))?.rules).toEqual([])
  } finally { await other.close() }
})

test('a conversation menu can opt in, mute temporarily and inherit', async ({ page }) => {
  await page.goto('/#/a/w1:p1')
  const open = async () => {
    await page.locator('#agent').getByRole('button', { name: 'Options', exact: true }).click()
    await page.getByRole('button', { name: 'Notifications', exact: true }).click()
  }
  await open()
  await page.getByRole('button', { name: 'Only needs you', exact: true }).click()
  await expect.poll(async () => (await stored(page))?.rules[0]?.events).toEqual(['needs-you'])
  await open()
  await page.getByRole('button', { name: 'Mute for 8 hours', exact: true }).click()
  await expect.poll(async () => (await stored(page))?.rules[0]?.mode).toBe('muted')
  const mute = (await stored(page)).rules[0]
  expect(mute.until).toBeGreaterThan(Date.now() + 7 * 3600000)
  await open()
  await page.getByRole('button', { name: 'Inherit notifications', exact: true }).click()
  await expect.poll(async () => (await stored(page))?.rules).toEqual([])
})

test('the main-coordinator preset mutes base machines and enables only the main conversation', async ({ page }) => {
  await page.route('**/api/tasks/links*', route => route.fulfill({ json: { version: 'example', machines: [{ machine: '', tasks: [],
    coordinators: [{ level: 'top', pane: 'w1:p1', workspace: 'w1' }, { level: 'machine', pane: 'w1:p2', workspace: 'w1' }],
  }] } }))
  await page.goto('/#/settings?section=notifications')
  await page.getByRole('button', { name: 'Only main coordinators', exact: true }).click()
  await expect.poll(async () => (await stored(page))?.rules.filter((r: { scope: string }) => r.scope === 'conversation')).toEqual([
    expect.objectContaining({ id: 'w1:p1', mode: 'on', events: ['needs-you', 'finished'] }),
  ])
  expect((await stored(page)).rules).toContainEqual(expect.objectContaining({ scope: 'machine', machine: '', mode: 'muted' }))
})

test('viewing heartbeat requires visibility and recent activity', async ({ page }) => {
  const viewing: { pane: string | null, visible: boolean }[] = []
  page.on('websocket', ws => ws.on('framesent', frame => {
    try { const m = JSON.parse(String(frame.payload)); if (m.type === 'viewing') viewing.push(m) } catch { /* other websocket */ }
  }))
  await page.goto('/#/a/w1:p1')
  await page.bringToFront()
  await page.locator('#agent').click({ position: { x: 10, y: 100 } })
  await expect.poll(() => viewing.some(v => v.pane === 'w1:p1' && v.visible)).toBe(true)
  await page.clock.install()
  await page.clock.fastForward(131000)
  await expect.poll(() => viewing.at(-1)?.visible).toBe(false)
  // A real interaction renews presence again.
  await page.mouse.click(10, 100)
  await expect.poll(() => viewing.at(-1)?.visible).toBe(true)
  // Headless Chromium keeps all tabs visible. Exercise the browser's
  // Page Visibility event with its hidden state rather than tab ordering.
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await expect.poll(() => viewing.at(-1)?.visible).toBe(false)
})

test('notifications screenshots on phone and desktop, with no horizontal overflow', async ({ page, browser }) => {
  test.setTimeout(60000)
  await seed(page)
  await fs.mkdir('.shots', { recursive: true })
  await page.addInitScript(() => localStorage.setItem('herdrLanguage', 'fr'))
  await page.goto('/#/settings?section=notifications')
  await expect(page.getByTestId('notification-rules')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: '.shots/notifications-mobile.png', fullPage: true })
  await page.locator('.notification-rule').last().scrollIntoViewIfNeeded()
  await page.screenshot({ path: '.shots/notifications-mobile-rules.png', fullPage: true })
  const desktop = await browser.newContext({ baseURL: BASE_URL, viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' })
  try {
    const p = await desktop.newPage()
    await p.addInitScript(() => localStorage.setItem('herdrLanguage', 'fr'))
    await p.goto('/#/settings?section=notifications')
    await expect(p.getByTestId('notification-rules')).toBeVisible()
    expect(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await p.screenshot({ path: '.shots/notifications-desktop.png', fullPage: true })
  } finally { await desktop.close() }
  await page.goto('/#/a/w1:p1')
  await page.locator('#agent').getByRole('button', { name: 'Options', exact: true }).click()
  await page.getByRole('button', { name: 'Notifications', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Muet pendant 1 h', exact: true })).toBeVisible()
  await page.screenshot({ path: '.shots/notifications-menu-mobile.png' })
})
