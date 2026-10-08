import { expect, test, type Page } from '@playwright/test'

// The launcher marks the guide done so the other specs reach the app; these
// tests reset it through the API, and always leave it done again.
const setDone = (page: Page, done: boolean) => page.evaluate(async (done) => {
  const r = await fetch('/api/onboarding', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ done }) })
  if (!r.ok) throw new Error(`onboarding: ${r.status}`)
}, done)

const guide = (page: Page) => page.getByRole('dialog', { name: 'Setup guide' })

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await setDone(page, false)
  await page.reload()
  await expect(guide(page)).toBeVisible()
})

test.afterEach(async ({ page }) => { await setDone(page, true) })

test('Skip closes the setup guide and it stays closed', async ({ page }) => {
  await guide(page).getByRole('button', { name: 'Skip' }).click()
  await expect(guide(page)).toHaveCount(0)
  await page.reload()
  await expect(page.locator('body')).toBeVisible()
  await page.waitForTimeout(500)
  await expect(guide(page)).toHaveCount(0)
})

test('Escape closes the setup guide', async ({ page, isMobile }) => {
  test.skip(isMobile, 'no keyboard on a phone')
  await page.keyboard.press('Escape')
  await expect(guide(page)).toHaveCount(0)
})

