import { expect, test } from './test'
import { SPLIT_SHELL_PANE } from './scenario.mjs'

test('closing an idle terminal does not show a process warning', async ({ page }) => {
  await page.goto(`/#/a/${SPLIT_SHELL_PANE}`)
  await expect(page.getByRole('button', { name: 'New tab', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Options', exact: true }).click()
  await page.getByText('Close this terminal', { exact: true }).click()
  const dialog = page.getByRole('dialog').filter({ hasText: 'Close the terminal in space' })
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('Close the terminal in space “split”?')
  await expect(dialog).not.toContainText('will be stopped')
  await page.screenshot({ path: '.shots/close-terminal-phone.png', animations: 'disabled', mask: [page.locator('.where')], maskColor: '#101419' })
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.screenshot({ path: '.shots/close-terminal-desktop.png', animations: 'disabled', mask: [page.locator('.where')], maskColor: '#101419' })
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(dialog).toHaveCount(0)
})
