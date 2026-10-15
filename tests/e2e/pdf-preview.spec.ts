import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { OMP_IMAGE_PANE, REVIEW_CSV, SAMPLE_PDF, SAMPLE_PDF_PAGES } from './scenario.mjs'
import { samplePdf } from './samplePdf.mjs'

// A PDF in the Files window: the browser's own viewer, framed, on the
// download path served `inline` as a PDF that runs nothing in the app's
// origin; "Open" gives the same URL to a new tab (the native viewer on an
// iPhone). Download still saves the file intact. Playwright's browsers have no
// PDF viewer (headless shell, Linux WebKit): what the page asks for and what
// the server answers is checked here, the rendering is checked by hand.
test('a PDF opens in the preview and stays a download', async ({ page }, info) => {
  await page.goto(`/#/a/${OMP_IMAGE_PANE}`)
  await expect(page.locator('.chat').getByText('The login button is clipped.')).toBeVisible()
  await page.locator('.agent-top').getByRole('button', { name: 'Options', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Browse files', exact: true }).or(page.getByRole('button', { name: 'Browse files', exact: true })).click()
  await page.locator('.files-entry', { hasText: 'notes' }).click()
  await page.locator('.files-entry', { hasText: 'style-guide.pdf' }).click()

  const frame = page.locator('iframe.files-pdf')
  await expect(frame).toBeVisible()
  await expect(page.locator('.files-crumb.current')).toHaveText('style-guide.pdf')
  await expect(page.locator('.files-view').getByText('Binary file')).toHaveCount(0)
  const src = (await frame.getAttribute('src'))!
  expect(src).toBe(`/api/files/download?pane=${encodeURIComponent(OMP_IMAGE_PANE)}&path=${encodeURIComponent(SAMPLE_PDF)}&inline=1`)
  expect(await frame.getAttribute('sandbox')).toBeNull()
  const open = page.locator('.files-view').getByRole('link', { name: 'Open', exact: true })
  await expect(open).toHaveAttribute('href', src)
  await expect(open).toHaveAttribute('target', '_blank')
  // The whole width of the view, and most of the screen's height.
  const box = (await frame.boundingBox())!
  const line = (await page.locator('.files-view .changes-location').boundingBox())!
  expect(Math.abs(box.width - line.width)).toBeLessThanOrEqual(2)
  expect(box.height).toBeGreaterThan(page.viewportSize()!.height * 0.5)
  if (process.env.SHOTS) {
    await page.waitForTimeout(400) // opening animation
    await page.screenshot({ path: `${process.env.SHOTS}/${info.project.name}-pdf-preview.png` })
  }

  // Served as a PDF only, framed by the app only, never sniffed.
  const shown = await page.request.get(src)
  expect(shown.status()).toBe(200)
  const h = shown.headers()
  expect(h['content-type']).toBe('application/pdf')
  expect(h['content-disposition']).toBe(`inline; filename="style-guide.pdf"; filename*=UTF-8''style-guide.pdf`)
  expect(h['x-content-type-options']).toBe('nosniff')
  expect(h['content-security-policy']).toBe("default-src 'none'; object-src 'self'; frame-ancestors 'self'")
  expect(Buffer.compare(await shown.body(), samplePdf(SAMPLE_PDF_PAGES))).toBe(0)
  // Any other file asked `inline` is still an attachment that runs nothing.
  const csv = await page.request.get(`/api/files/download?pane=${encodeURIComponent(OMP_IMAGE_PANE)}&path=${encodeURIComponent(REVIEW_CSV)}&inline=1`)
  expect(csv.headers()['content-type']).toBe('application/octet-stream')
  expect(csv.headers()['content-disposition']).toMatch(/^attachment;/)
  expect(csv.headers()['content-security-policy']).toContain('sandbox')

  const saving = page.waitForEvent('download')
  await page.locator('.files-view').getByRole('button', { name: 'Download', exact: true }).click()
  const saved = await saving
  expect(saved.suggestedFilename()).toBe('style-guide.pdf')
  expect(Buffer.compare(readFileSync(await saved.path()), samplePdf(SAMPLE_PDF_PAGES))).toBe(0)
})
