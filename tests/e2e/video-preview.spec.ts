import { expect, test, type Page } from '@playwright/test'
import { OMP_IMAGE_PANE, SAMPLE_MP4, SAMPLE_WEBM, fixture } from './scenario.mjs'

const inline = (file: string) => `/api/files/download?pane=${encodeURIComponent(OMP_IMAGE_PANE)}&path=${encodeURIComponent(file)}&inline=1`

async function openNotes(page: Page) {
  await page.goto(`/#/a/${OMP_IMAGE_PANE}`)
  await expect(page.locator('.chat').getByText('The login button is clipped.')).toBeVisible()
  await page.locator('.agent-top').getByRole('button', { name: 'Options', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Browse files', exact: true }).or(page.getByRole('button', { name: 'Browse files', exact: true })).click()
  await page.locator('.files-entry', { hasText: 'notes' }).click()
}

test('a video plays in the Files preview, streamed in pieces', async ({ page }, info) => {
  const statuses: number[] = []
  page.on('response', (r) => { if (r.url().endsWith(inline(SAMPLE_WEBM))) statuses.push(r.status()) })
  await openNotes(page)
  await page.locator('.files-entry', { hasText: 'walkthrough.webm' }).click()

  const video = page.locator('video.files-video')
  await expect(video).toBeVisible()
  await expect(page.locator('.files-crumb.current')).toHaveText('walkthrough.webm')
  await expect(page.locator('.files-view').getByText('Binary file')).toHaveCount(0)
  await expect(video).toHaveAttribute('src', inline(SAMPLE_WEBM))
  expect(await video.evaluate((v: HTMLVideoElement) => v.controls && v.playsInline)).toBe(true)
  // Metadata read through Range requests, every answer a 206.
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => Math.round(v.duration))).toBe(2)
  expect(statuses.length).toBeGreaterThan(0)
  expect(statuses.every(s => s === 206)).toBe(true)
  // It really plays.
  await video.evaluate((v: HTMLVideoElement) => { v.muted = true; return v.play() })
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime)).toBeGreaterThan(0.2)
  await video.evaluate((v: HTMLVideoElement) => v.pause())

  // The view's width, never wider than the screen.
  const box = (await video.boundingBox())!
  const line = (await page.locator('.files-view .changes-location').boundingBox())!
  expect(Math.abs(box.width - line.width)).toBeLessThanOrEqual(2)
  expect(await page.locator('.files-view').evaluate(e => e.scrollWidth <= e.clientWidth)).toBe(true)

  const open = page.locator('.files-view').getByRole('link', { name: 'Open', exact: true })
  await expect(open).toHaveAttribute('href', inline(SAMPLE_WEBM))
  await expect(open).toHaveAttribute('target', '_blank')
  if (process.env.SHOTS) {
    await video.evaluate((v: HTMLVideoElement) => { v.currentTime = 1 })
    await page.locator('.hw-sheet-body').evaluate(e => { e.scrollTop = 0 })
    await page.waitForTimeout(600) // opening animation, seeked frame
    await page.screenshot({ path: `${process.env.SHOTS}/${info.project.name}-video-preview.png` })
  }
})

test('video pieces follow the Range header', async ({ page }) => {
  const webm = fixture('sample.webm')
  const size = webm.length
  const get = (range?: string) => page.request.get(inline(SAMPLE_WEBM), { headers: range ? { range } : {} })

  // Safari's first probe: exactly two bytes.
  const probe = await get('bytes=0-1')
  expect(probe.status()).toBe(206)
  const h = probe.headers()
  expect(h['content-range']).toBe(`bytes 0-1/${size}`)
  expect(h['content-length']).toBe('2')
  expect(h['accept-ranges']).toBe('bytes')
  expect(h['content-type']).toBe('video/webm')
  expect(h['x-content-type-options']).toBe('nosniff')
  expect(h['content-disposition']).toBe(`inline; filename="walkthrough.webm"; filename*=UTF-8''walkthrough.webm`)
  expect(Buffer.compare(await probe.body(), webm.subarray(0, 2))).toBe(0)

  const open = await get('bytes=1000-')
  expect(open.status()).toBe(206)
  expect(open.headers()['content-range']).toBe(`bytes 1000-${size - 1}/${size}`)
  expect(Buffer.compare(await open.body(), webm.subarray(1000))).toBe(0)

  const tail = await get('bytes=-10')
  expect(tail.headers()['content-range']).toBe(`bytes ${size - 10}-${size - 1}/${size}`)
  expect(Buffer.compare(await tail.body(), webm.subarray(size - 10))).toBe(0)

  const none = await get()
  expect(none.status()).toBe(206)
  expect(Buffer.compare(await none.body(), webm)).toBe(0)

  const past = await get(`bytes=${size}-`)
  expect(past.status()).toBe(416)
  expect(past.headers()['content-range']).toBe(`bytes */${size}`)

  const mp4 = await page.request.get(inline(SAMPLE_MP4), { headers: { range: 'bytes=0-' } })
  expect(mp4.status()).toBe(206)
  expect(mp4.headers()['content-type']).toBe('video/mp4')
  expect(Buffer.compare(await mp4.body(), fixture('sample.mp4'))).toBe(0)
  // Without inline=1 a video is still only a download.
  const saved = await page.request.get(inline(SAMPLE_MP4).replace('&inline=1', ''))
  expect(saved.status()).toBe(200)
  expect(saved.headers()['content-type']).toBe('application/octet-stream')
})

test('an MP4 opens the player, and a video that cannot play leaves Open', async ({ page }) => {
  await openNotes(page)
  await page.locator('.files-entry', { hasText: 'walkthrough.mp4' }).click()
  // H.264 is missing from some test browsers: the player, or the notice.
  const notice = page.getByRole('alert').filter({ hasText: 'This video cannot be played here.' })
  await expect(page.locator('video.files-video').or(notice)).toBeVisible()
  await expect(page.locator('.files-view').getByText('Binary file')).toHaveCount(0)

  await page.locator('.files-view').getByRole('button', { name: 'Back to folder' }).click()
  await page.route('**/api/files/download?**', route => route.fulfill({ status: 500, body: 'Unavailable' }))
  await page.locator('.files-entry', { hasText: 'walkthrough.webm' }).click()
  await expect(notice).toBeVisible()
  await expect(page.locator('.files-view').getByRole('link', { name: 'Open', exact: true })).toBeVisible()
  await expect(page.locator('.files-view').getByRole('button', { name: 'Download', exact: true })).toBeVisible()
})
