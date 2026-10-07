import { expect, test } from '@playwright/test'
import { OMP_APPROVAL_PANE } from './scenario.mjs'

test('an action waiting for its approval stays in progress, without the finished-turn line', async ({ page }) => {
  await page.goto(`/#/a/${OMP_APPROVAL_PANE}`)
  await expect(page.locator('.chat').getByText('Clean the build folder.')).toBeVisible()
  await expect(page.locator('.tools.live')).toBeVisible()
  await expect(page.locator('.turn-end')).toHaveCount(0)
})
