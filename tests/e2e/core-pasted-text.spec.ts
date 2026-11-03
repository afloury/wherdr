import { expect, test, type FakeCore, type Page } from './fake-core'

// Port of pasted-text.spec.ts to herdr-core: one Claude Code terminal whose conversation
// holds a pasted log, quoted points and a long typed message, and whose fake agent writes
// each message it receives into that conversation.
const PASTED_LOG = Array.from({ length: 40 }, (_, i) => `==> Pouring libexample-${i}--2.1.0.arm64_sonoma.bottle.tar.gz`).join('\n')
const TYPED_QUOTES = Array.from({ length: 5 }, (_, i) =>
  `↳ Quote point 09:0${i} : Point ${i + 1}: ${'the cache entry is kept after an update and should expire. '.repeat(5).trim()} —\nAnswer ${i + 1}: agreed, go ahead with that one.`).join('\n')
const LONG_TYPED = Array.from({ length: 24 }, (_, i) => `Step ${i + 1}: check the cache entry again.`).join('\n')

const agent = (core: FakeCore) => core.claude('acme-api', [
  ['user', 'After updating a user, GET /users/:id still returns the old name. Find out why.'],
  ['assistant', '`getUser` caches users forever and `updateUser` never clears the entry. I will add an expiry and clear it on update.'],
  ['user', `The install fails, here is the log:\n\n<pasted_content id="a1f2">\n${PASTED_LOG}\n</pasted_content id="a1f2">`],
  ['assistant', 'The bottle is fine; the link step fails.'],
  ['user', `<pasted_content id="b7c3">\n${TYPED_QUOTES}\n</pasted_content id="b7c3">`],
  ['assistant', 'Understood, point by point.'],
  ['user', LONG_TYPED],
  ['assistant', 'All steps noted.'],
], { reply: 'Got it.' })

async function pasteInField(page: Page, words: string, log: string) {
  const field = page.locator('.prompt').locator('textarea, [contenteditable="true"]').first()
  await field.click()
  await page.keyboard.type(words)
  await field.evaluate((el, text) => {
    const data = new DataTransfer()
    data.setData('text/plain', text)
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
  }, log)
  return field
}

test('a pasted log is a card that opens the whole text; a long typed message folds', async ({ page, context, core }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.goto(agent(core).url)
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
  await more.click()
  await expect(typed.getByRole('button', { name: 'Show less' })).toBeVisible()
  expect((await typed.boundingBox())!.height).toBeGreaterThan(folded + 100)
  await expect(typed).toContainText(LONG_TYPED.split('\n').at(-1)!)

  // The card opens the whole log, monospace, with Copy.
  await card.locator('.pasted-open').click()
  const sheet = page.locator('.hw-sheet')
  await expect(sheet.locator('.pasted-full.mono')).toHaveText(PASTED_LOG)
  await expect(sheet.locator('.hw-sheet-title')).toBeInViewport()
  await sheet.getByRole('button', { name: 'Copy' }).click()
  await expect(page.locator('.hw-toast-title', { hasText: 'Text copied' })).toBeVisible()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(PASTED_LOG)
})

test('a long message typed in the field is a plain message with its quotes, not a card', async ({ page, core }) => {
  await page.goto(agent(core).url)
  await expect(page.locator('.chat').getByText('All steps noted.')).toBeVisible()
  const typed = page.locator('.msg-user', { hasText: 'Answer 1: agreed' })
  await typed.scrollIntoViewIfNeeded()
  await expect(typed.locator('.pasted-card')).toHaveCount(0)
  await expect(typed.locator('.msg-ref')).toHaveCount(5)
  await expect(typed.locator('.msg-ref').first()).toContainText('Point 1: the cache entry')
  await expect(typed.locator('.msg-ref').first()).not.toContainText('Quote point')
  // Long: folded like any long message, the whole text one tap away.
  await typed.getByRole('button', { name: 'Show more' }).click()
  await expect(typed).toContainText('Answer 5: agreed, go ahead with that one.')
})

test('a long paste into the field becomes a card, sent as it is, and is the same card on another device', async ({ page, core, browser, baseURL, viewport, userAgent, deviceScaleFactor, isMobile, hasTouch, locale, timezoneId }) => {
  const claude = agent(core)
  await page.goto(claude.url)
  await expect(page.locator('.chat').getByText('All steps noted.')).toBeVisible()
  const marker = String(Date.now())
  const words = `Why does this fail? ${marker}`
  const log = PASTED_LOG.replace('libexample-0-', `libexample-0-${marker}-`)
  const field = await pasteInField(page, words, log)

  // A card in the field, not 40 lines of text.
  const chip = page.locator('.prompt .attachments .pasted-card')
  await expect(chip).toContainText('Pasted text · 40 lines')
  await expect(field).toHaveValue(words)
  await page.locator('.prompt-send').click()
  await expect(chip).toHaveCount(0)
  // Core received the whole paste, as text.
  await expect.poll(() => claude.sends.length).toBe(1)
  expect(claude.sends[0]).toContain(words)
  expect(claude.sends[0]).toContain(log)

  // Settled in the conversation: the typed words, and the paste as a card.
  const sent = page.locator('.msg-user:not(.msg-pending)', { hasText: words }).last()
  await expect(sent.locator('.pasted-card')).toContainText('Pasted text · 40 lines', { timeout: 15_000 })
  await expect(sent.locator('.pasted-line').first()).toContainText(marker)

  // Another device: its own storage, it never sent this paste.
  const other = await browser.newContext({ baseURL, viewport, userAgent, deviceScaleFactor, isMobile, hasTouch, locale, timezoneId, serviceWorkers: 'block' })
  try {
    await other.addCookies(await page.context().cookies())
    const page2 = await other.newPage()
    await page2.goto(claude.url)
    const seen = page2.locator('.msg-user:not(.msg-pending)', { hasText: words })
    await expect(seen).toBeVisible()
    expect(await page2.evaluate(() => localStorage.getItem('sentPastes'))).toBeNull()
    await expect(seen.locator('.pasted-card')).toHaveCount(1)
    await expect(seen.locator('.pasted-card')).toContainText('Pasted text · 40 lines')
    await expect(seen.locator('.pasted-line').first()).toContainText(marker)
    await expect(seen).not.toContainText('libexample-39')
    await seen.scrollIntoViewIfNeeded()
    await seen.locator('.pasted-open').click()
    await expect(page2.locator('.hw-sheet .pasted-full')).toHaveText(log)
  } finally {
    await other.close()
  }
})
