import { expect, test, type Page } from './test'
import { CLAUDE_ASK_PANE, CLAUDE_PANE, OMP_CHAT_PANE } from './scenario.mjs'

async function typeInField(page: Page, text: string) {
  const field = page.locator('.prompt').locator('textarea, [contenteditable="true"]').first()
  await field.click()
  await page.keyboard.type(text)
}

test('Claude Code: "/" lists the project skill and command next to the built-in ones', async ({ page }, testInfo) => {
  await page.goto(`/#/a/${CLAUDE_PANE}`)
  await typeInField(page, '/dai')
  const menu = page.locator('.slash-menu')
  await expect(menu.locator('.slash-item', { hasText: '/daily-notes' })).toBeVisible()
  await expect(menu.locator('.slash-item', { hasText: '/daily-check' })).toBeVisible()
  if (testInfo.project.name === 'chromium-phone') await page.screenshot({ path: '.shots/slash-menu-claude-phone.png' })
  await page.keyboard.press('Backspace')
  await page.keyboard.press('Backspace')
  await page.keyboard.press('Backspace')
  await page.keyboard.type('compa')
  await expect(menu.locator('.slash-item', { hasText: '/compact' })).toBeVisible()
  await menu.locator('.slash-item', { hasText: '/compact' }).first().click()
  await expect(menu).toHaveCount(0)
})

test('omp: "/" lists the project command', async ({ page }) => {
  await page.goto(`/#/a/${OMP_CHAT_PANE}`)
  await expect(page.locator('.chat').getByText('Ready when you are.')).toBeVisible()
  await typeInField(page, '/dai')
  await expect(page.locator('.slash-menu .slash-item', { hasText: '/daily-sync' })).toBeVisible()
})

test('Claude Code: "/" lists a command from the .claude/ of a parent folder', async ({ page }) => {
  await page.goto(`/#/a/${CLAUDE_ASK_PANE}`)
  await typeInField(page, '/team')
  await expect(page.locator('.slash-menu .slash-item', { hasText: '/team-standup' })).toBeVisible()
  await expect(page.locator('.slash-denied')).toHaveCount(0)
})

test('Claude Code: project folders macOS refuses to list are explained in the menu', async ({ page }, testInfo) => {
  // A Mac reached over SSH without full disk access (simulated: the fake
  // machine is Linux).
  await page.route('**/api/commands?**', async (route) => {
    const r = await route.fetch()
    await route.fulfill({ response: r, json: { ...(await r.json()), denied: 'macos', remote: true } })
  })
  await page.goto(`/#/a/${CLAUDE_PANE}`)
  await typeInField(page, '/journal')
  const note = page.locator('.slash-menu .slash-denied')
  await expect(note).toContainText('macOS hides this project’s commands')
  await expect(note).toContainText('Allow full disk access for remote users')
  await expect(page.locator('.slash-menu .slash-item')).toHaveCount(0)
  if (testInfo.project.name === 'chromium-phone') await page.screenshot({ path: '.shots/slash-menu-denied-phone.png' })
  // Matching commands stay listed above the note.
  await page.locator('.prompt').locator('textarea, [contenteditable="true"]').first().fill('')
  await page.keyboard.type('/dai')
  await expect(page.locator('.slash-menu .slash-item', { hasText: '/daily-notes' })).toBeVisible()
  await expect(note).toBeVisible()
})


test('Claude Code: plugin skills and commands keep their namespace when selected', async ({ page }) => {
  await page.goto(`/#/a/${CLAUDE_PANE}`)
  await typeInField(page, '/circleci:')
  const menu = page.locator('.slash-menu')
  await expect(menu.locator('.slash-item', { hasText: '/circleci:build' })).toContainText('Inspect the CI build')
  await expect(menu.locator('.slash-item', { hasText: '/circleci:config' })).toBeVisible()
  await expect(menu.locator('.slash-item', { hasText: '/circleci:deploy' })).toContainText('Deploy the CI build')
  await page.screenshot({ path: '.shots/slash-plugins-iphone13.png' })
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.screenshot({ path: '.shots/slash-plugins-1440.png' })
  await menu.locator('.slash-item', { hasText: '/circleci:build' }).click()
  const field = page.locator('.prompt').locator('textarea, [contenteditable="true"]').first()
  await expect(field).toHaveValue('/circleci:build ')
  await expect(menu).toHaveCount(0)
})
