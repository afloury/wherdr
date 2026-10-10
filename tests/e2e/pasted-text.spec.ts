import { expect, test, type Page } from '@playwright/test'
import { CLAUDE_PANE, LONG_TYPED, OMP_CHAT_PANE, PASTED_LOG, TYPED_QUOTES } from './scenario.mjs'

const shot = (page: Page, name: string, project: string) =>
  process.env.SHOTS ? page.screenshot({ path: `${process.env.SHOTS}/${project}-${name}.png` }) : Promise.resolve()

test('a pasted log is a card that opens the whole text; a long typed message folds', async ({ page, context, browserName }, testInfo) => {
  if (browserName === 'chromium') await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.goto(`/#/a/${CLAUDE_PANE}`)
  await expect(page.locator('.chat').getByText('All steps noted.')).toBeVisible()

  // The user's words stay in the bubble; the paste is a card with its first lines.
  const bubble = page.locator('.msg-user', { hasText: 'The install fails, here is the log:' })
  const card = bubble.locator('.pasted-card')
  await expect(card).toContainText('Pasted text · 40 lines')
  await expect(card.locator('.pasted-line').first()).toHaveText('==> Pouring libexample-0--2.1.0.arm64_sonoma.bottle.tar.gz')
  await expect(bubble).not.toContainText('libexample-39')

  // Long typed message: folded, Show more / Show less.
  const typed = page.locator('.msg-user', { hasText: 'Step 1: check' })
  await typed.scrollIntoViewIfNeeded()
  const more = typed.getByRole('button', { name: 'Show more' })
  await expect(more).toBeVisible()
  const folded = (await typed.boundingBox())!.height
  await shot(page, 'conversation', testInfo.project.name)
  await more.click()
  await expect(typed.getByRole('button', { name: 'Show less' })).toBeVisible()
  expect((await typed.boundingBox())!.height).toBeGreaterThan(folded + 100)
  await expect(typed).toContainText(LONG_TYPED.split('\n').at(-1)!)

  // The card opens the whole log, monospace, with Copy.
  await card.locator('.pasted-open').click()
  const sheet = page.locator('.hw-sheet')
  await expect(sheet.locator('.pasted-full.mono')).toHaveText(PASTED_LOG)
  await expect(sheet.locator('.hw-sheet-title')).toBeInViewport()
  await page.waitForTimeout(400) // end of the sheet animation, for the screenshot
  await shot(page, 'pasted-sheet', testInfo.project.name)
  await sheet.getByRole('button', { name: 'Copy' }).click()
  await expect(page.locator('.hw-toast-title', { hasText: 'Text copied' })).toBeVisible()
  if (browserName === 'chromium') expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(PASTED_LOG)
})

test('a long message typed in the field is a plain message with its quotes, not a card', async ({ page }, testInfo) => {
  await page.goto(`/#/a/${CLAUDE_PANE}`)
  await expect(page.locator('.chat').getByText('All steps noted.')).toBeVisible()
  expect(TYPED_QUOTES.split('\n')).toHaveLength(10)
  expect(TYPED_QUOTES.length).toBeGreaterThan(1500)

  const typed = page.locator('.msg-user', { hasText: 'Answer 1: agreed' })
  await typed.scrollIntoViewIfNeeded()
  await expect(typed.locator('.pasted-card')).toHaveCount(0)
  await expect(typed.locator('.msg-q')).toHaveCount(5)
  await expect(typed.locator('.msg-q').first()).toContainText('Point 1: the cache entry')
  await expect(typed.locator('.msg-q').first()).not.toContainText('>')
  await shot(page, 'typed-quotes', testInfo.project.name)
  // Long: folded like any long message, the whole text one tap away.
  await typed.getByRole('button', { name: 'Show more' }).click()
  await expect(typed).toContainText('Answer 5: agreed, go ahead with that one.')
  await shot(page, 'typed-quotes-open', testInfo.project.name)
})

test('a long paste into the field becomes a card, sent as it is', async ({ page }, testInfo) => {
  await page.goto(`/#/a/${OMP_CHAT_PANE}`)
  await expect(page.locator('.chat').getByText('Ready when you are.')).toBeVisible()
  const marker = `${testInfo.project.name} ${Date.now()}`
  const log = PASTED_LOG.replace('libexample-0-', `libexample-0-${marker}-`)
  const field = page.locator('.prompt').locator('textarea, [contenteditable="true"]').first()
  await field.click()
  await page.keyboard.type('Why does this fail?')
  await field.evaluate((el, text) => {
    const data = new DataTransfer()
    data.setData('text/plain', text)
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
  }, log)

  // A card in the field, not 40 lines of text.
  const chip = page.locator('.prompt .attachments .pasted-card')
  await expect(chip).toContainText('Pasted text · 40 lines')
  await expect(field).toHaveValue('Why does this fail?')
  await shot(page, 'composer-card', testInfo.project.name)
  await page.locator('.prompt-send').click()
  await expect(chip).toHaveCount(0)

  // Settled in the conversation: the typed words, and the paste as a card.
  const sent = page.locator('.msg-user:not(.msg-pending)', { hasText: 'Why does this fail?' }).last()
  await expect(sent.locator('.pasted-card')).toContainText('Pasted text · 40 lines', { timeout: 15_000 })
  await expect(sent.locator('.pasted-line').first()).toContainText(marker)
  await shot(page, 'sent-card', testInfo.project.name)
})
