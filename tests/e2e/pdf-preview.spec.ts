import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { OMP_IMAGE_PANE, REVIEW_CSV, SAMPLE_PDF, SAMPLE_PDF_PAGES } from './scenario.mjs'
import { pdfSession } from './pdfAuth.mjs'
import { samplePdf } from './samplePdf.mjs'

// Exercise real canvas rendering in Linux WebKit as well as Chromium.
test('a PDF opens in the preview and stays a download', async ({ page }, info) => {
  if (process.env.E2E_PDF_AUTH) {
    const denied = await page.request.get(`/api/files/download?pane=${encodeURIComponent(OMP_IMAGE_PANE)}&path=${encodeURIComponent(SAMPLE_PDF)}&inline=1`)
    expect(denied.status()).toBe(401)
    await page.context().addCookies([{ name: 'hw_session', value: pdfSession(), url: info.project.use.baseURL || `http://127.0.0.1:${process.env.E2E_PORT || 7699}`, httpOnly: true, sameSite: 'Strict' }])
  }
  const pdfRequests: string[] = []
  page.context().on('request', r => { if (/\/pdf(?:\.min|\.worker)/.test(r.url())) pdfRequests.push(r.url()) })
  await page.goto(`/#/a/${OMP_IMAGE_PANE}`)
  await expect(page.locator('.chat').getByText('The login button is clipped.')).toBeVisible()
  await page.locator('.agent-top').getByRole('button', { name: 'Options', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Browse files', exact: true }).or(page.getByRole('button', { name: 'Browse files', exact: true })).click()
  await page.locator('.files-entry', { hasText: 'notes' }).click()
  expect(pdfRequests).toHaveLength(0)
  await page.locator('.files-entry', { hasText: 'style-guide.pdf' }).click()

  const frame = page.locator('.files-pdf')
  await expect(frame).toBeVisible()
  await expect(page.locator('.files-crumb.current')).toHaveText('style-guide.pdf')
  await expect(page.locator('.files-view').getByText('Binary file')).toHaveCount(0)
  const src = `/api/files/download?pane=${encodeURIComponent(OMP_IMAGE_PANE)}&path=${encodeURIComponent(SAMPLE_PDF)}&inline=1`
  const pages = frame.locator('.pdf-page')
  await expect(pages).toHaveCount(SAMPLE_PDF_PAGES.length)
  await expect(pages.first().locator('canvas')).toBeVisible()
  expect(pdfRequests.some(url => url.includes('pdf.min'))).toBe(true)
  expect(pdfRequests.some(url => url.includes('pdf.worker'))).toBe(true)
  expect(pdfRequests.every(url => new URL(url).origin === new URL(page.url()).origin)).toBe(true)
  await expect(pages.last().locator('canvas')).toHaveCount(0)
  for (let i = 0; i < SAMPLE_PDF_PAGES.length; i++) {
    await pages.nth(i).scrollIntoViewIfNeeded()
    await expect(pages.nth(i).locator('canvas')).toBeVisible()
    const bitmap = await pages.nth(i).locator('canvas').evaluate((c: HTMLCanvasElement) => ({ width: c.width, css: c.clientWidth, pixels: [...c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data].some((v, n) => n % 4 !== 3 && v < 100) }))
    expect(bitmap.width).toBeGreaterThanOrEqual(bitmap.css * (info.project.name.includes('phone') ? 2 : 1))
    expect(bitmap.pixels).toBe(true)
  }
  await expect(pages.first().locator('canvas')).toHaveCount(0)
  expect(await frame.evaluate(e => e.scrollWidth <= e.clientWidth)).toBe(true)
  expect(src).toBe(`/api/files/download?pane=${encodeURIComponent(OMP_IMAGE_PANE)}&path=${encodeURIComponent(SAMPLE_PDF)}&inline=1`)
  const originalViewport = page.viewportSize()!
  await page.setViewportSize({ ...originalViewport, width: originalViewport.width + 60 })
  await pages.first().scrollIntoViewIfNeeded()
  await expect(pages.first().locator('canvas')).toBeVisible()
  await page.setViewportSize(originalViewport)
  await expect.poll(async () => pages.first().locator('canvas').evaluate((c: HTMLCanvasElement) => Math.abs(c.clientWidth - c.parentElement!.clientWidth))).toBeLessThanOrEqual(1)
  const open = page.locator('.files-view').getByRole('link', { name: 'Open', exact: true })
  await expect(open).toHaveAttribute('href', src)
  await expect(open).toHaveAttribute('target', '_blank')
  // The whole width of the view, and most of the screen's height.
  const box = (await frame.boundingBox())!
  const line = (await page.locator('.files-view .changes-location').boundingBox())!
  expect(Math.abs(box.width - line.width)).toBeLessThanOrEqual(2)
  expect(box.height).toBeGreaterThan(100)
  if (process.env.SHOTS) {
    await pages.first().scrollIntoViewIfNeeded()
    await expect(pages.first().locator('canvas')).toBeVisible()
    await page.locator('.hw-sheet-body').evaluate(e => { e.scrollTop = 0 })
    await page.waitForTimeout(400) // opening animation
    await page.screenshot({ path: `${process.env.SHOTS}/${info.project.name}-pdf-preview.png` })
  }

  // Open performs a real new-tab navigation with the browser's session cookie.
  const openedResponse = page.context().waitForEvent('response', r => r.url().endsWith(src))
  await open.click()
  expect((await openedResponse).status()).toBe(200)
  for (const tab of page.context().pages()) if (tab !== page) await tab.close()

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

if (!process.env.E2E_PDF_AUTH) test('PDF loading and errors leave Open usable', async ({ page }) => {
  await page.goto(`/#/a/${OMP_IMAGE_PANE}`)
  await expect(page.locator('.chat').getByText('The login button is clipped.')).toBeVisible()
  await page.locator('.agent-top').getByRole('button', { name: 'Options', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Browse files', exact: true }).or(page.getByRole('button', { name: 'Browse files', exact: true })).click()
  await page.locator('.files-entry', { hasText: 'notes' }).click()
  let fail!: () => void
  const waiting = new Promise<void>(resolve => { fail = resolve })
  await page.route('**/api/files/download?**', async route => {
    await waiting
    await route.fulfill({ status: 500, body: 'Unavailable' })
  })
  await page.locator('.files-entry', { hasText: 'style-guide.pdf' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Loading PDF…' })).toBeVisible()
  fail()
  await expect(page.getByRole('alert').filter({ hasText: 'Could not preview this PDF.' })).toBeVisible()
  await expect(page.locator('.files-view').getByRole('link', { name: 'Open', exact: true })).toBeVisible()
})
