import { expect, test } from './test'

// Isolated API fixtures; no coordinator commands or real board data are used.
for (const language of ['en', 'fr']) {
test(`scheduled disclosure (${language}) is lazy, read only, compact on phone and desktop, and refreshes with the board`, async ({ page }) => {
  await page.addInitScript(language => localStorage.setItem('herdrLanguage', language), language)
  let reads = 0
  let empty = false
  await page.route('**/api/tasks', route => route.fulfill({ json: { version: 'scheduled', machines: [{ machine: '', status: 'ready', version: '1.2.1', tasks: [] }] } }))
  await page.route('**/api/tasks?**', route => route.fulfill({ json: { same: true } }))
  await page.route('**/api/tasks/coordinator?**', route => route.fulfill({ json: { state: 'none', pane: null } }))
  await page.route('**/api/tasks/scheduled?**', route => {
    reads++
    expect(route.request().method()).toBe('GET')
    return route.fulfill({ json: { timezone: 'Australia/Brisbane', warnings: [],
      autopilot: empty ? null : { on: true, frequency: 'every 2h', goal: 'Keep the demo build green', today: '1 of 3 added · 1 of 2 under way', last: Date.parse('2026-01-05T00:00:00Z'), next: Date.parse('2026-01-05T02:00:00Z') },
      automations: empty ? [] : [{ id: 'demo', name: 'Weekly audit', trigger: 'mon 09:00', on: true, last: Date.parse('2026-01-04T23:00:00Z'), next: Date.parse('2026-01-11T23:00:00Z'), tasks: ['demo/12'] }],
      timers: empty ? [] : [{ id: 'job-demo', cron: '*/5 * * * *', recurring: true, next: Date.parse('2026-01-05T02:05:00Z'), prompt: 'Check deployment status' }],
    } })
  })
  await page.goto('/#/board?machine=&coordinator=demo')
  const section = page.locator('.coordinator-scheduled')
  await expect(section).toBeVisible()
  expect(reads).toBe(0)
  await section.locator('summary').click()
  await expect(section).toContainText('Keep the demo build green')
  await expect(section).toContainText(language === 'fr' ? 'Session : perdus si la session se ferme' : 'Session: lost when the session closes')
  await expect(section).toContainText(language === 'fr' ? 'Tous les lundis à 09:00' : 'Every Monday at 09:00')
  await expect(section).toContainText(/05\/01\/2026.*12:00/)
  await expect(section.getByRole('link', { name: 'demo/12' })).toHaveAttribute('href', '/#/board?machine=&task=demo%2F12')
  await expect(section.locator('button, input')).toHaveCount(0)
  await page.screenshot({ path: `.shots/coordinator-scheduled-phone-${language}.png` })
  await section.locator('.scheduled-content').evaluate(el => { el.scrollTop = el.scrollHeight })
  await page.screenshot({ path: `.shots/coordinator-scheduled-timers-phone-${language}.png` })
  await section.locator('.scheduled-content').evaluate(el => { el.scrollTop = 0 })
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.screenshot({ path: `.shots/coordinator-scheduled-desktop-${language}.png` })
  expect(await section.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
  empty = true
  const beforeReopen = reads
  await section.locator('summary').click()
  await section.locator('summary').click()
  await expect(section).toContainText(language === 'fr' ? 'Rien de programmé' : 'Nothing scheduled')
  expect(reads).toBeGreaterThan(beforeReopen)
  await expect(section).not.toContainText('Keep the demo build green')
  await page.getByRole('button', { name: language === 'fr' ? 'Actualiser' : 'Refresh', exact: true }).click()
  await expect(section).toContainText(language === 'fr' ? 'Rien de programmé' : 'Nothing scheduled')
  const before = reads
  await section.locator('summary').click()
  await page.getByRole('button', { name: language === 'fr' ? 'Actualiser' : 'Refresh', exact: true }).click()
  await expect.poll(() => reads).toBe(before)
  await section.locator('summary').click()
  await expect.poll(() => reads).toBeGreaterThan(before)
})

}
