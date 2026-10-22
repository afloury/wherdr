// 2.0: the normal list is the default. A compact list turned on in 1.x
// (localStorage `compactList`) goes back to normal once, on the first 2.0
// load; compact turned on again afterwards is kept.
import { BASE_URL } from './scenario.mjs'
import { expect, test, type Page } from './test'

const serverSettings = async (page: Page) => (await (await page.request.get('/api/settings')).json()).settings as Record<string, string>
const compactSwitch = (page: Page) => page.locator('.settings-toggle', { hasText: 'Compact list' }).getByRole('switch')

test('new install: the normal list, Compact list off', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('#home .card').first()).toBeVisible()
  await expect(page.locator('#home')).not.toHaveClass(/list-compact/)
  await page.goto('/#/settings?section=appearance')
  await expect(compactSwitch(page)).toHaveAttribute('aria-checked', 'false')
  expect(await serverSettings(page)).not.toHaveProperty('compactListV2')
})

test('1.x compact list: normal once on the first 2.0 load, then compact turned on again is kept', async ({ page }) => {
  await page.addInitScript(() => {
    if (localStorage.getItem('v1Fixture')) return
    localStorage.setItem('v1Fixture', '1')
    localStorage.setItem('compactList', '1')
  })
  await page.goto('/')
  await expect(page.locator('#home .card').first()).toBeVisible()
  await expect(page.locator('#home')).not.toHaveClass(/list-compact/)
  // The 1.x value is gone from the browser and never reached the server.
  await expect.poll(() => page.evaluate(() => localStorage.getItem('compactList'))).toBeNull()
  await expect.poll(() => page.evaluate(() => localStorage.getItem('syncedSettingsMigrated'))).toBe('1')
  expect(await serverSettings(page)).not.toHaveProperty('compactList')

  await page.goto('/#/settings?section=appearance')
  const toggle = compactSwitch(page)
  await expect(toggle).toHaveAttribute('aria-checked', 'false')
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-checked', 'true')
  await expect.poll(() => serverSettings(page)).toMatchObject({ compactListV2: '1' })

  await page.goto('/')
  await page.reload()
  await expect(page.locator('#home .card').first()).toBeVisible()
  await expect(page.locator('#home')).toHaveClass(/list-compact/)

  // Another 1.x browser opening 2.0 for the first time follows the 2.0 choice.
  const other = await page.context().browser()!.newContext({ baseURL: BASE_URL, viewport: page.viewportSize(), serviceWorkers: 'block' })
  const b = await other.newPage()
  await b.addInitScript(() => {
    if (localStorage.getItem('v1Fixture')) return
    localStorage.setItem('v1Fixture', '1')
    localStorage.setItem('compactList', '0')
  })
  await b.goto('/')
  await expect(b.locator('#home')).toHaveClass(/list-compact/)
  await other.close()
})
