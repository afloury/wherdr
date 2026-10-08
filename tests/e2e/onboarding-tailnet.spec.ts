import { expect, test, type Page } from '@playwright/test'

// The setup guide on localhost while wherdr's tailnet address is published
// and answers: a "Continue on <address>" button reopens the guide at the same
// step there, and the Security step sends the passkey to that address.
// /api/phone is intercepted: no Tailscale in the test box.
const URL = 'https://box.example.ts.net:7683/'
const NAME = 'box.example.ts.net'
const published = {
  mode: 'native', platform: 'linux', port: '7683', connected: true, https: true, url: URL, served: true, taken: false,
  suggested: URL, command: '', reach: 'ok', reachCause: null, reachStatus: 200, checkedAt: Date.now(), appUrl: URL, appUrlFromEnv: false,
  qr: { size: 9, path: 'M2 2h1v1h-1zM4 4h1v1h-1zM6 6h1v1h-1z' },
}
const missing = { ...published, mode: 'missing', connected: false, https: false, url: null, served: false, suggested: null, reach: null, reachStatus: null, checkedAt: null, appUrl: '', qr: null }

const setDone = (page: Page, done: boolean) => page.evaluate(async (done) => {
  const r = await fetch('/api/onboarding', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ done }) })
  if (!r.ok) throw new Error(`onboarding: ${r.status}`)
}, done)

const guide = (page: Page) => page.getByRole('dialog', { name: 'Setup guide' })
const go = (page: Page) => guide(page).getByRole('link', { name: `Continue on ${NAME}` })
const next = (page: Page) => guide(page).getByRole('button', { name: 'Next' })

async function open(page: Page, phone: object, hash = '') {
  await page.route('**/api/phone', route => route.fulfill({ json: phone }))
  await page.goto('/')
  await setDone(page, false)
  await page.goto(`/${hash}`)
  await page.reload()
  await expect(guide(page)).toBeVisible()
}

test.afterEach(async ({ page }) => { await setDone(page, true) })

test('offers to continue on the tailnet address, at the same step', async ({ page }, testInfo) => {
  await open(page, published)
  await expect(go(page)).toHaveAttribute('href', `${URL}#/setup?step=welcome`)
  await page.screenshot({ path: `.shots/tailnet-welcome-${testInfo.project.name}.png` })
  await next(page).click()
  await expect(go(page)).toHaveAttribute('href', `${URL}#/setup?step=phone`)
  await page.screenshot({ path: `.shots/tailnet-phone-${testInfo.project.name}.png` })
})

test('the Security step sends the passkey to the tailnet address', async ({ page }, testInfo) => {
  await open(page, published)
  await next(page).click()
  await next(page).click()
  await expect(guide(page)).toContainText('A passkey only works on the address it was created on')
  await expect(go(page)).toHaveCount(1)
  await expect(go(page)).toHaveAttribute('href', `${URL}#/setup?step=security`)
  await expect(guide(page).getByRole('button', { name: 'Enable passkey lock' })).toHaveCount(0)
  await page.screenshot({ path: `.shots/tailnet-security-${testInfo.project.name}.png` })
})

test('#/setup?step=security opens the guide at that step', async ({ page }) => {
  await open(page, missing, '#/setup?step=security')
  await expect(guide(page).locator('[aria-current="step"]')).toHaveText('Security')
  await expect(guide(page).getByRole('button', { name: 'Finish' })).toBeVisible()
})

test('without a tailnet address the guide stays on localhost', async ({ page }) => {
  await open(page, missing)
  await expect(go(page)).toHaveCount(0)
  await next(page).click()
  await expect(guide(page)).toContainText('Not installed on this computer.')
  await expect(go(page)).toHaveCount(0)
  await next(page).click()
  await expect(guide(page).getByRole('button', { name: 'Enable passkey lock' })).toBeVisible()
  await expect(go(page)).toHaveCount(0)
})

test('Settings › Security on localhost links the tailnet address too', async ({ page }) => {
  await page.route('**/api/phone', route => route.fulfill({ json: published }))
  await page.goto('/#/settings?section=security')
  await expect(page.getByRole('link', { name: `Continue on ${NAME}` })).toHaveAttribute('href', `${URL}#/settings?section=security`)
})
