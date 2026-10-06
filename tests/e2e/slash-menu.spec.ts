import { expect, test, type Page } from '@playwright/test'
import { CLAUDE_PANE, OMP_CHAT_PANE } from './scenario.mjs'

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
