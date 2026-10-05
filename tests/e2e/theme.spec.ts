import { expect, test } from '@playwright/test'

test('empty storage lands on the wherdr Titanium theme', async ({ page }) => {
  await page.goto('/')
  const html = page.locator('html')
  await expect(html).toHaveAttribute('data-theme', 'wherdr-titanium')
  const bg = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--bg').trim().toLowerCase())
  expect(bg).toBe('#12151b')
  await expect(page.locator('meta[name="theme-color"]').first()).toHaveAttribute('content', '#12151b')
})
