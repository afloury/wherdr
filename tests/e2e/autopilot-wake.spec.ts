import { expect, test } from './test'
import { OMP_CHAT_PANE } from './scenario.mjs'

for (const language of ['en', 'fr']) {
  test(`autopilot attribution in coordinator conversation (${language})`, async ({ page }) => {
    await page.addInitScript(language => localStorage.setItem('herdrLanguage', language), language)
    const wakes = ['Autopilot: Check ready work.\nBoard context: no pending replies.', 'Autopilot woke: Check older work.']
    await page.route('**/api/tasks', route => route.fulfill({ json: { version: 'wake', machines: [{ machine: '', status: 'ready', version: '1.2.16', tasks: [] }] } }))
    await page.route('**/api/tasks?**', route => route.fulfill({ json: { same: true } }))
    await page.route('**/api/tasks/coordinator?**', route => route.fulfill({ json: { state: 'idle', pane: OMP_CHAT_PANE } }))
    await page.route('**/api/chat?**', route => route.fulfill({ json: { available: true, token: 'wake', file: '/demo/transcript.jsonl', items: [
      ...wakes.map(text => ({ role: 'user', text, ts: null })),
      { role: 'user', text: 'Please explain Autopilot: behavior.', ts: null },
      { role: 'assistant', text: 'Autopilot: an assistant reply.', ts: null },
    ] } }))
    await page.goto('/#/board?machine=&coordinator=demo')
    const panel = page.locator('.board-panel')
    await expect(panel.locator('.msg-autopilot')).toHaveCount(2)
    for (const [i, text] of wakes.entries()) await expect(panel.locator('.msg-autopilot-body').nth(i)).toHaveText(text)
    await expect(panel.locator('.msg-user')).toHaveCount(1)
    await expect(panel.locator('.msg-ai')).toContainText('Autopilot: an assistant reply.')
    for (const [size, width, height] of [['phone', 390, 844], ['desktop', 1440, 900]] as const) {
      await page.setViewportSize({ width, height })
      await expect(panel.locator('.msg-autopilot').first()).toBeVisible()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await page.screenshot({ path: `.shots/autopilot-${language}-${size}.png` })
    }
  })
}
