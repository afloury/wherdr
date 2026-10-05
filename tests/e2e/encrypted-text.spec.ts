import { expect, test } from '@playwright/test'

test('Settings › Conversation: the encrypted text preview types glyphs, then the plain text', async ({ page }) => {
  await page.goto('/#/settings')
  await page.locator('.settings-nav-item', { hasText: 'Conversation' }).click()

  const section = page.locator('.settings-typing')
  const toggle = section.locator('.encrypted-toggle').getByRole('switch')
  const preview = section.locator('.typing-sample')
  const glyphs = preview.locator('.tw-trail [data-g]')

  // Turned off, then back on, the way a user would: turning it on replays the preview.
  if (await toggle.getAttribute('aria-checked') === 'true') {
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-checked', 'false')
  }
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-checked', 'true')

  // Cipher glyphs over the text being written…
  await expect(glyphs.first()).toBeAttached()
  expect(await glyphs.first().getAttribute('data-g')).toMatch(/^\S$/u)
  // …then the plain text, with no glyph left.
  await expect(glyphs).toHaveCount(0)
  await expect(preview).toContainText('Found the cause: the cache was never invalidated after an update.')
  await expect(preview).toContainText('All tests pass.')
})
