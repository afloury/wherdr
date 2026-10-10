import { expect, test, type Page } from '@playwright/test'
import { OMP_QUESTIONS_PANE } from './scenario.mjs'

// Settings › Conversation › Quoted replies (utils/quoteTokens.ts): one list
// for the device in use, tokens in the native field by default, and a
// preview played once with a Replay button.
const shot = (page: Page, name: string, project: string) =>
  process.env.SHOTS ? page.screenshot({ path: `${process.env.SHOTS}/${project}-${name}.png` }) : Promise.resolve()

const saved = (page: Page, key: string) => page.evaluate(k => localStorage.getItem(k), key)

async function settings(page: Page) {
  await page.goto('/#/settings')
  await page.locator('.settings-nav-item', { hasText: 'Conversation' }).click()
  const group = page.locator('.settings-group', { has: page.locator('h3', { hasText: 'Quoted replies' }) })
  await expect(group).toBeVisible()
  const radio = (value: string) => group.locator(`[role="radio"][value="${value}"]`)
  return { group, radio }
}

test('an empty storage gets tokens in the native field, from one list', async ({ page }, testInfo) => {
  const { group, radio } = await settings(page)

  await expect(radio('native')).toHaveAttribute('aria-checked', 'true')
  expect(await saved(page, 'quoteMode')).toBe('native')

  // One list of three choices, no title per device kind.
  await expect(group.locator('[role="radiogroup"]')).toHaveCount(1)
  await expect(group.locator('[role="radio"]')).toHaveCount(3)
  await expect(group).not.toContainText('On a computer')
  await expect(group).not.toContainText('On a phone')

  // "Default." and no badge on the native field; the rich field keeps its badge.
  const item = (label: string) => group.locator('.settings-radio label', { hasText: label }).locator('xpath=ancestor::*[.//*[@role="radio"]][1]')
  await expect(item('Tokens, native field')).toContainText('Default.')
  await expect(item('Tokens, native field')).not.toContainText('Experimental')
  await expect(item('“>” lines')).not.toContainText('Default.')
  await expect(item('Tokens, rich field')).toContainText('Experimental')
  await expect(group.locator('.exp-tag')).toHaveCount(1)

  await group.scrollIntoViewIfNeeded()
  await shot(page, 'quote-mode-settings', testInfo.project.name)
})

test('the former per-device values are overwritten once, then a new choice is kept', async ({ page }) => {
  await page.goto('/#/settings')
  // A device of an earlier version: a value per device kind, the single key absent.
  await page.evaluate(() => {
    localStorage.removeItem('quoteMode')
    localStorage.setItem('quoteModeComputer', 'lines')
    localStorage.setItem('quoteModePhone', 'rich')
    localStorage.setItem('quoteTokensComputer', '1')
    localStorage.setItem('quoteTokensPhone', '0')
  })
  await page.reload()
  let { radio } = await settings(page)
  await expect(radio('native')).toHaveAttribute('aria-checked', 'true')
  expect(await saved(page, 'quoteMode')).toBe('native')
  for (const key of ['quoteModeComputer', 'quoteModePhone', 'quoteTokensComputer', 'quoteTokensPhone'])
    expect(await saved(page, key)).toBeNull()

  // A choice made afterwards survives a reload.
  await radio('lines').click()
  await expect(radio('lines')).toHaveAttribute('aria-checked', 'true')
  expect(await saved(page, 'quoteMode')).toBe('lines')
  await page.reload()
  ;({ radio } = await settings(page))
  await expect(radio('lines')).toHaveAttribute('aria-checked', 'true')
  expect(await saved(page, 'quoteMode')).toBe('lines')
})

test('the preview plays once, then Replay plays it again', async ({ page }, testInfo) => {
  const { group } = await settings(page)
  const preview = group.locator('.qt-preview')
  const replay = preview.getByRole('button', { name: 'Replay' })
  const running = () => preview.locator('.qt-stage').evaluate(el => el.getAnimations({ subtree: true }).filter(a => a.playState === 'running').length)

  await expect(preview).toHaveAttribute('data-mode', 'native')
  await expect(preview).toHaveAttribute('data-playing', 'true')
  expect(await running()).toBeGreaterThan(0)

  // The 10 s timeline ends on the composed field and does not start again.
  await expect(preview).toHaveAttribute('data-playing', 'false', { timeout: 15_000 })
  expect(await running()).toBe(0)
  await expect(preview.locator('.qt-tok.two')).toBeVisible()
  await shot(page, 'quote-mode-preview-ended', testInfo.project.name)
  await page.waitForTimeout(1_500)
  await expect(preview).toHaveAttribute('data-playing', 'false')
  expect(await running()).toBe(0)

  await replay.click()
  await expect(preview).toHaveAttribute('data-playing', 'true')
  expect(await running()).toBeGreaterThan(0)
})

test('the message field draws a quoted question as a token by default', async ({ page }, testInfo) => {
  await page.addInitScript(() => localStorage.setItem('typewriterSpeed', 'off'))
  await page.goto(`/#/a/${OMP_QUESTIONS_PANE}`)
  const chat = page.locator('.chat')
  await expect(chat.getByText('All 48 tests pass.')).toBeVisible()
  await chat.locator('.q-reply[data-q="Shall I start step 1 now?"]').click()

  const field = page.locator('.prompt textarea').first()
  await expect(field).toHaveValue(/^> Shall I start step 1 now\?/)
  // The native field with its mirror behind it (utils/quoteMirror.ts).
  await expect(field).toHaveClass(/qm-on/)
  await expect(page.locator('.prompt .qm-mirror .qm-q')).toHaveCount(1)
  await shot(page, 'quote-mode-field', testInfo.project.name)
})
