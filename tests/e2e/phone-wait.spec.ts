import http from 'node:http'
import { expect, test } from '@playwright/test'
import { PORT } from './scenario.mjs'

// Settings › Phone right after publishing: the address waits for Tailscale's
// HTTPS certificate (a loader, no error, no QR code), then turns green with
// the QR code. /api/phone is intercepted: no Tailscale in the test box.
const URL = 'https://box.example.ts.net:7683/'
const status = (reach: 'pending' | 'ok') => ({
  mode: 'native', platform: 'linux', port: '7683', connected: true, https: true, url: URL, served: true, taken: false,
  suggested: URL, command: '', reach, reachCause: reach === 'ok' ? null : 'timeout', reachStatus: reach === 'ok' ? 200 : null,
  checkedAt: Date.now(), appUrl: URL, appUrlFromEnv: false,
  qr: reach === 'ok' ? { size: 9, path: 'M2 2h1v1h-1zM4 4h1v1h-1zM6 6h1v1h-1z' } : null,
})

test('waits for the HTTPS certificate with a loader, then shows the QR code', async ({ page }, testInfo) => {
  let reach: 'pending' | 'ok' = 'pending'
  await page.route('**/api/phone', route => route.fulfill({ json: status(reach) }))
  await page.goto('/#/settings?section=phone')
  const answers = page.locator('.phone-steps li', { hasText: 'ANSWERS' })
  await expect(answers).toContainText('Getting the HTTPS certificate from Tailscale')
  await expect(answers).toHaveClass(/\bwait\b/)
  await expect(page.locator('.phone-qr')).toHaveCount(0)
  await expect(page.getByRole('alert')).toHaveCount(0)
  await expect(page.locator('.phone-result.bad')).toHaveCount(0)
  await page.screenshot({ path: `.shots/phone-wait-${testInfo.project.name}.png` })

  reach = 'ok'
  await expect(answers).toHaveClass(/\bdone\b/, { timeout: 8000 })
  await expect(answers).toContainText('Your phone can open it.')
  await expect(page.locator('.phone-qr svg')).toBeVisible()
  await expect(page.locator('.phone-result.bad, .phone-note.warn')).toHaveCount(0)
  await page.screenshot({ path: `.shots/phone-ready-${testInfo.project.name}.png` })
})

// A browser opening an address that is not allowed yet: a readable page, not
// raw JSON; the API keeps its JSON error.
function get(path: string, accept: string) {
  return new Promise<{ status: number, type: string, body: string }>((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: PORT, path, headers: { host: 'not-enabled.example.ts.net', accept } }, (res) => {
      let body = ''
      res.setEncoding('utf8')
      res.on('data', (c) => { body += c })
      res.on('end', () => resolve({ status: res.statusCode || 0, type: String(res.headers['content-type']), body }))
    }).on('error', reject)
  })
}

test('a refused host gets a readable page in a browser, JSON for the API', async ({ page }, testInfo) => {
  const html = await get('/', 'text/html,application/xhtml+xml,*/*;q=0.8')
  expect(html.status).toBe(403)
  expect(html.type).toContain('text/html')
  expect(html.body).toContain('This address isn\'t enabled yet.')
  const api = await get('/api/state', 'text/html,*/*')
  expect(api.status).toBe(403)
  expect(JSON.parse(api.body)).toMatchObject({ code: 'host' })
  await page.setContent(html.body)
  await expect(page.getByRole('heading', { name: 'This address isn\'t enabled yet.' })).toBeVisible()
  await page.screenshot({ path: `.shots/host-refused-${testInfo.project.name}.png` })
})
