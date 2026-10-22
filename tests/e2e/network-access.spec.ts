import { expect, test } from './test'

// The e2e server runs on 127.0.0.1: this computer, so it answers, and
// Settings › Security says who else may reach it. The passkey is never required.
test('Settings › Security explains network access, good practices and an optional passkey', async ({ page }) => {
  await page.goto('/#/settings?section=security')
  await expect(page.getByText('wherdr only answers this computer (localhost) and your tailnet.')).toBeVisible()
  const tips = page.locator('.settings-section .network-tips')
  await expect(tips).toContainText('Prefer Tailscale')
  await expect(tips).toContainText('A network added without HTTPS gets no passkey')
  await expect(tips).toContainText('Create a passkey as soon as wherdr is reached over HTTPS.')
  await expect(page.getByRole('heading', { name: 'Passkey · optional' })).toBeVisible()
  await expect(page.locator('.open-network-banner')).toHaveCount(0)
})

test('Settings › Phone answers without a passkey', async ({ request }) => {
  const r = await request.get('/api/phone')
  expect(r.status()).toBe(200)
})

test('a request a local proxy forwards from the open network is refused', async ({ request }) => {
  const r = await request.get('/api/config', { headers: { 'x-forwarded-for': '192.168.1.50' } })
  expect(r.status()).toBe(403)
  expect((await r.json()).code).toBe('network')
  const ok = await request.get('/api/config', { headers: { 'x-forwarded-for': '127.0.0.1' } })
  expect(ok.status()).toBe(200)
})
