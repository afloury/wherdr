import { expect, test } from '@playwright/test'

// Agent list header: at the minimum sidebar width the buttons must stay inside the
// row. No plugin button there: plugin actions are in the machine row's "…" menu.
for (const width of [null, 280]) {
  for (const lang of ['en', 'fr']) {
    test(`header buttons fit (sidebar ${width ?? 'default'}, ${lang})`, async ({ page }) => {
      await page.addInitScript(([w, l]) => {
        // No service worker in the tests: resolve the push lookup at once.
        Object.defineProperty(ServiceWorkerContainer.prototype, 'ready', { get: () => Promise.resolve({ pushManager: { getSubscription: async () => null } }) })
        if (w) localStorage.setItem('listWidth', String(w))
        localStorage.setItem('herdrLanguage', String(l))
      }, [width, lang] as const)
      await page.route('**/api/push/quiet', route => route.fulfill({ json: { global: { until: null }, device: null } }))
      await page.route('**/api/plugins/actions**', route => route.fulfill({
        json: { actions: [
          { plugin: 'demo', pluginName: 'Demo', id: 'run', title: 'Demo: Run', label: 'Run', description: null, agent: false, machine: true, confirm: false, inHerdr: false },
          { plugin: 'demo', pluginName: 'Demo', id: 'board', title: 'Demo: Board', label: 'Board', description: null, agent: false, machine: true, confirm: false, inHerdr: true },
        ] },
      }))
      await page.goto('/')
      const row = page.locator('.home-title-row')
      await expect(page.locator('.home-version')).toBeVisible()
      await expect(page.locator('.solo-machine-options')).toBeVisible()
      await expect(row.locator('.home-actions [aria-label="Plugin actions"], .home-actions [aria-label="Actions des plugins"]')).toHaveCount(0)
      const box = (await row.boundingBox())!
      const buttons = row.locator('.home-actions button, .home-actions a')
      const n = await buttons.count()
      expect(n).toBeGreaterThanOrEqual(2)
      for (let i = 0; i < n; i++) {
        const b = (await buttons.nth(i).boundingBox())!
        expect(b.x).toBeGreaterThanOrEqual(box.x - 7)
        expect(b.x + b.width).toBeLessThanOrEqual(box.x + box.width + 7)
      }
      const scrolls = await page.locator('.home-top').evaluate(el => el.scrollWidth > el.clientWidth)
      expect(scrolls).toBe(false)
      // The sidebar itself clips nothing: the last button ends inside it.
      const side = (await page.locator('.home-top').boundingBox())!
      const last = (await buttons.nth(n - 1).boundingBox())!
      expect(last.x + last.width).toBeLessThanOrEqual(side.x + side.width)
      // Folded buttons stay reachable through "…".
      if (await row.locator('.space-menu').count()) {
        await row.locator('.space-menu').click()
        await expect(page.getByText(lang === 'fr' ? /Réglages/ : /Settings/).last()).toBeVisible()
        await page.keyboard.press('Escape')
      }
      // Plugin actions: machine row "…" › Plugin actions; Herdr-side ones say so.
      await page.locator('.solo-machine-options').click()
      await page.getByText(lang === 'fr' ? 'Actions des plugins' : 'Plugin actions').last().click()
      await expect(page.getByText('Board').last()).toBeVisible()
      await expect(page.getByText(lang === 'fr' ? /S’ouvre dans Herdr/ : /Opens in Herdr/).last()).toBeVisible()
    })
  }
}

test('the eyebrow shows both versions and opens Settings › About', async ({ page }) => {
  await page.goto('/')
  const link = page.locator('.home-version')
  await expect(link).toHaveText(/^wherdr \d+\.\d+\.\d+ · herdr /)
  await link.click()
  await expect(page).toHaveURL(/section=about/)
})

test('the crossed-out bell opens the notification settings without turning quiet off', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(ServiceWorkerContainer.prototype, 'ready', { get: () => Promise.resolve({ pushManager: { getSubscription: async () => null } }) })
  })
  const writes: unknown[] = []
  await page.route('**/api/push/quiet', (route) => {
    const body = route.request().postDataJSON() as { on?: boolean } | null
    if (body && 'on' in body) writes.push(body)
    return route.fulfill({ json: { global: { until: null }, device: null } })
  })
  await page.goto('/')
  const bell = page.getByRole('link', { name: 'Notifications silenced — open settings' }).first()
  await expect(bell).toBeVisible()
  await bell.click()
  await expect(page).toHaveURL(/section=notifications/)
  await expect(page.locator('.quiet-toggle').first()).toBeVisible()
  expect(writes).toEqual([])
})
