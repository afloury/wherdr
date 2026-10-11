import { expect, test, type Page } from '@playwright/test'
import { BASE_URL } from './scenario.mjs'

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

async function setDone(page: Page, done: boolean) {
  const r = await page.request.post('/api/onboarding', { headers: { Origin: BASE_URL }, data: { done } })
  expect(r.ok()).toBe(true)
}

const guide = (page: Page) => page.getByRole('dialog', { name: 'Setup guide' })
const go = (page: Page) => guide(page).getByRole('link', { name: `Continue on ${NAME}` })
const next = (page: Page) => guide(page).getByRole('button', { name: 'Next' })

async function open(page: Page, phone: object, hash = '') {
  await page.route('**/api/phone', route => route.fulfill({ json: phone }))
  await setDone(page, false)
  // Navigate once with the requested step intact. setup.vue replaces the
  // hash with / after opening the guide, so a reload would lose that step.
  await page.goto(`/${hash}`)
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

test('a direct Security link stays at that step when the first-launch check arrives late', async ({ page }) => {
  await setDone(page, true)
  await page.route('**/api/phone', route => route.fulfill({ json: missing }))
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  await page.route('**/api/onboarding', async route => {
    await gate
    await route.fulfill({ json: { done: true } })
  })
  try {
    await page.goto('/#/setup?step=security')
    await expect(guide(page).locator('[aria-current="step"]')).toHaveText('Security')
    // The route has finished opening the guide and replacing its URL.
    await expect(page).toHaveURL(`${BASE_URL}/#/`)
    const checked = page.waitForResponse(r => r.url().endsWith('/api/onboarding'))
    release()
    await (await checked).finished()
    await expect(guide(page).locator('[aria-current="step"]')).toHaveText('Security')
    await expect(guide(page).getByRole('button', { name: 'Finish' })).toBeVisible()
  } finally { release() }
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
