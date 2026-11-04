import { expect, test } from './test'
import { OMP_CHAT_PANE } from './scenario.mjs'

test('an older shell offers an update without reloading the open view', async ({ page }) => {
  // Model a successful SW registration while keeping this test's cache isolated.
  await page.addInitScript(() => {
    Object.defineProperty(navigator.serviceWorker, 'register', { value: async () => ({
      waiting: null, installing: null, addEventListener() {},
    }) })
  })
  await page.route('**/_nuxt/builds/latest.json?*', route => route.fulfill({ json: { id: 'next-deployment' } }))
  let navigations = 0
  page.on('request', req => {
    if (req.isNavigationRequest() && req.frame() === page.mainFrame()) navigations++
  })
  await page.goto(`/#/a/${OMP_CHAT_PANE}`)
  const banner = page.locator('.new-version')
  await expect(banner).toContainText('New version available')
  await expect(page.locator('.chat').getByText('Ready when you are.')).toBeVisible()
  expect(navigations).toBe(1)
  await banner.getByRole('button', { name: 'Later', exact: true }).click()
  await expect(banner).toHaveCount(0)
  await expect(page.locator('.chat').getByText('Ready when you are.')).toBeVisible()
  expect(navigations).toBe(1)
  // Only the user's Reload action navigates; the deep link survives it.
  await page.reload()
  await expect(banner).toBeVisible()
  expect(navigations).toBe(2)
  await banner.getByRole('button', { name: 'Reload', exact: true }).click()
  await expect.poll(() => navigations).toBe(3)
  await expect(page.locator('.chat').getByText('Ready when you are.')).toBeVisible()
  await expect(page).toHaveURL(new RegExp(`#/a/${OMP_CHAT_PANE}$`))
})
