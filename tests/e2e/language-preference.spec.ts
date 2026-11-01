import { expect, test } from './test'

// Baseline for the English-only migration: update these expectations when it ships.
for (const { locale, saved } of [
  { locale: 'fr-FR', saved: null },
  { locale: 'en-US', saved: 'fr' },
  { locale: 'fr-FR', saved: 'fr' },
]) test.describe(`browser ${locale}, saved ${saved ?? 'none'}`, () => {
  test.use({ locale })
  test('language preference survives a reload', async ({ page }) => {
    await page.goto('/')
    await page.evaluate(value => {
      if (value) localStorage.setItem('herdrLanguage', value)
      else localStorage.removeItem('herdrLanguage')
    }, saved)
    await page.goto('/#/settings?section=appearance')
    await page.reload()
    await expect(page.getByRole('heading', { name: 'Langue', exact: true })).toBeVisible()
    await expect(page.locator('html')).toHaveAttribute('lang', 'fr')
    await expect.poll(() => page.evaluate(() => localStorage.getItem('herdrLanguage'))).toBe(saved)
    await page.reload()
    await expect(page.getByRole('heading', { name: 'Langue', exact: true })).toBeVisible()
  })
})
