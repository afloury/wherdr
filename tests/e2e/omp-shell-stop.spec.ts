import { expect, test } from '@playwright/test'
import { OMP_SHELL_PANE } from './scenario.mjs'

// omp writes nothing for a "!" command cancelled before its first prompt: the
// message must not come back as "Queued · sending…" once the run is gone.
test('Stop cancels an omp "!" command and the message does not go back to the queue', async ({ page }) => {
  await page.goto(`/#/a/${OMP_SHELL_PANE}`)
  const field = page.locator('.prompt').locator('textarea, [contenteditable="true"]').first()
  await field.click()
  await field.fill('! sleep 30')
  await page.locator('.prompt-send').click()

  const stop = page.getByRole('button', { name: 'Cancel the command' })
  await expect(stop).toBeVisible()
  await expect(page.locator('.queued-tag.running')).toBeVisible()
  await stop.click()
  await expect(page.locator('.hw-toast-title', { hasText: 'Command cancelled' })).toBeVisible()
  await expect(stop).toHaveCount(0)
  // Several polls later, still nothing waiting.
  await page.waitForTimeout(3000)
  await expect(page.locator('.msg-pending')).toHaveCount(0)
  await expect(page.locator('.queued-tag')).toHaveCount(0)
})
