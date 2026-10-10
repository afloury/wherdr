import { expect, test, type Page } from '@playwright/test'

// Records every card the list ever renders, from the first one: a detailed card
// shown for an instant before the compact one would be caught here.
async function watchCards(page: Page) {
  await page.addInitScript(() => {
    const seen = { compact: 0, detailed: 0 }
    Object.assign(window, { __cards: seen })
    const scan = () => {
      for (const el of document.querySelectorAll('#home .card')) seen[el.classList.contains('compact') ? 'compact' : 'detailed']++
    }
    new MutationObserver(scan).observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] })
  })
}
const cards = (page: Page) => page.evaluate(() => (window as unknown as { __cards: { compact: number, detailed: number } }).__cards)

const compactSwitch = (page: Page) => page.locator('.settings-toggle', { hasText: 'Compact list' }).getByRole('switch')

test('empty storage: the agent list is compact from the first render', async ({ page }) => {
  await watchCards(page)
  await page.goto('/')
  await expect(page.locator('#home')).toHaveClass(/list-compact/)
  await expect(page.locator('#home .card.compact').first()).toBeVisible()
  await expect(page.locator('#home .card:not(.compact)')).toHaveCount(0)
  const seen = await cards(page)
  expect(seen.compact).toBeGreaterThan(0)
  expect(seen.detailed).toBe(0)
  // Never touched: nothing saved, so the setting keeps following the default.
  expect(await page.evaluate(() => localStorage.getItem('compactList'))).toBeNull()
})

test('Compact list turned off stays off after a reload', async ({ page }) => {
  await page.goto('/#/settings?section=appearance')
  const toggle = compactSwitch(page)
  await expect(toggle).toHaveAttribute('aria-checked', 'true')
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-checked', 'false')
  expect(await page.evaluate(() => localStorage.getItem('compactList'))).toBe('0')

  await watchCards(page)
  await page.goto('/')
  await page.reload()
  await expect(page.locator('#home .card').first()).toBeVisible()
  await expect(page.locator('#home')).not.toHaveClass(/list-compact/)
  await expect(page.locator('#home .card.compact')).toHaveCount(0)
  await expect(page.locator('#home .card .card-meta').first()).toBeVisible()
  expect((await cards(page)).compact).toBe(0)

  await page.goto('/#/settings?section=appearance')
  await expect(compactSwitch(page)).toHaveAttribute('aria-checked', 'false')
})
