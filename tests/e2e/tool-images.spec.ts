import { expect, test } from '@playwright/test'
import { OMP_IMAGE_PANE } from './scenario.mjs'

test('an image an omp tool read shows under the folded console and opens in the viewer', async ({ page }) => {
  await page.goto(`/#/a/${OMP_IMAGE_PANE}`)
  await expect(page.locator('.chat').getByText('The login button is clipped.')).toBeVisible()

  // The read call is folded out of the console ("1 earlier actions"), its image is not.
  const consoleBlock = page.locator('.omp-console')
  await expect(consoleBlock.locator('.omp-console-more')).toBeVisible()
  const thumb = consoleBlock.locator('.tool-thumbs .msg-img')
  await expect(thumb).toHaveCount(1)
  await expect.poll(() => thumb.evaluate(img => (img as HTMLImageElement).naturalWidth)).toBe(240)

  await thumb.click()
  const viewer = page.locator('.lightbox img')
  await expect(viewer).toBeVisible()
  await expect(viewer).toHaveAttribute('src', /\/api\/chat\/image\?pane=/)
})
