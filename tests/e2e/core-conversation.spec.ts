import { expect, test, type FakeCore, type Page } from './fake-core'

// A Claude Code conversation on herdr-core, end to end in a real browser. Merged from
// send-message, pasted-text, paragraphs and long-content.spec.ts. Covered elsewhere and so not
// repeated: ">>>" and "> " lines (components/UserText), typed quotes staying a message and
// pasted cards seen from another device (pastedText.test.ts, pastes.test.ts, UserText),
// sending the paste unchanged (components/ComposerReferences), the incremental reply
// (chatDelta.test.ts). What stays needs layout, the clipboard or the server and core together.
const PASTED_LOG = Array.from({ length: 40 }, (_, i) => `==> Pouring libexample-${i}--2.1.0.arm64_sonoma.bottle.tar.gz`).join('\n')
const LONG_TYPED = Array.from({ length: 24 }, (_, i) => `Step ${i + 1}: check the cache entry again.`).join('\n')
const PARAGRAPHS = 'First paragraph.\n\nSecond paragraph.\n\n\nThird paragraph.'
const LONG_WORD = `Pneumono${'ultramicroscopicsilicovolcano'.repeat(12)}coniosis`
const LONG_URL = `https://example.com/acme-api/releases/${'nested-segment/'.repeat(24)}changelog.html?ref=${'abcdef0123456789'.repeat(6)}`
const WIDE_CODE = `const endpoints = [${Array.from({ length: 14 }, (_, i) => `'/v1/resources/${i}/sub-resources/details'`).join(', ')}]`
const TABLE = [
  '| Endpoint | Method | Median latency | p99 latency | Error rate | Owner team | Notes |',
  '|---|---|---|---|---|---|---|',
  ...Array.from({ length: 5 }, (_, i) =>
    `| /v1/resources/${i}/sub-resources/details-with-a-long-name | GET | ${12 + i} ms | ${140 + i} ms | 0.0${i} % | platform-reliability-and-observability | cached-response-without-invalidation-${i} |`),
].join('\n')
const LONG_END = 'End of the long build report.'

const agent = (core: FakeCore) => core.claude('acme-api', [
  ['user', `The install fails, here is the log:\n\n<pasted_content id="a1f2">\n${PASTED_LOG}\n</pasted_content id="a1f2">`],
  ['assistant', 'The bottle is fine; the link step fails.'],
  ['user', PARAGRAPHS],
  ['assistant', [`The build passes. One unbroken token from the log: ${LONG_WORD}`, `Full report: ${LONG_URL}`,
    '```js\n' + WIDE_CODE + '\n```', TABLE, LONG_END].join('\n\n')],
  ['user', LONG_TYPED],
  ['assistant', 'All steps noted.'],
], { reply: 'Got it.' })

// Pastes `text` into the message field, as the clipboard would.
const paste = (page: Page, text: string) => page.locator('.prompt textarea').evaluate((el, text) => {
  const data = new DataTransfer()
  data.setData('text/plain', text)
  el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
}, text)

test('a typed message with a long paste: a card in the field, pending, then settled with the reply, the same after a reload', async ({ page, core }) => {
  const claude = agent(core)
  await page.goto(claude.url)
  await expect(page.locator('.chat').getByText('All steps noted.')).toBeVisible()
  const words = `Why does this fail? ${Date.now()}`
  const log = PASTED_LOG.replace('libexample-0-', 'libexample-0-again-')
  const field = page.locator('.prompt textarea')
  await field.click()
  await page.keyboard.type(words)
  await paste(page, log)
  // A card in the field, not 40 lines of text.
  const chip = page.locator('.prompt .attachments .pasted-card')
  await expect(chip).toContainText('Pasted text · 40 lines')
  await expect(field).toHaveValue(words)
  await page.locator('.prompt-send').click()
  await expect(chip).toHaveCount(0)

  // Pending at once, before the agent took the message; core got the words and the whole paste.
  const pending = page.locator('.msg-pending', { hasText: words })
  await expect(pending).toBeVisible()
  await expect.poll(() => claude.sends.length).toBe(1)
  expect(claude.sends[0]).toContain(words)
  expect(claude.sends[0]).toContain(log)
  // Settled from the conversation file: one bubble with the paste as a card, then the reply.
  await expect(pending).toHaveCount(0)
  const sent = page.locator('.msg-user:not(.msg-pending)', { hasText: words })
  await expect(sent).toHaveCount(1)
  await expect(sent.locator('.pasted-card')).toContainText('Pasted text · 40 lines')
  await expect(sent.locator('.pasted-line').first()).toContainText('libexample-0-again-')
  const messages = page.locator('.chat-list .msg-user, .chat-list .msg-ai')
  await expect(messages.last()).toHaveText('Got it.')
  const live = await messages.allInnerTexts()
  await page.reload()
  await expect(page.locator('.msg-user:not(.msg-pending)', { hasText: words })).toHaveCount(1)
  await expect.poll(() => messages.allInnerTexts()).toEqual(live)
})

test('a conversation lays out at 320 px: no sideways scroll, blank lines kept, a folded message, a pasted log to open and copy', async ({ page, context, core }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.setViewportSize({ width: 320, height: 844 })
  await page.goto(agent(core).url)
  const chat = page.locator('.chat')
  await expect(chat.getByText('All steps noted.')).toBeVisible()

  // Wide pieces: the code block scrolls inside itself; neither the page nor the list scrolls sideways.
  await expect(chat.getByText(LONG_END)).toBeVisible()
  await expect(chat.locator('table').first()).toBeAttached()
  const widths = await page.evaluate(() => {
    const doc = document.scrollingElement!
    const box = document.querySelector('.chat')!
    const code = [...box.querySelectorAll('pre')].find(p => p.textContent!.includes('const endpoints'))!
    return { doc: [doc.scrollWidth, doc.clientWidth], chat: [box.scrollWidth, box.clientWidth], code: [code.scrollWidth, code.clientWidth] }
  })
  expect(widths.code[0], 'code block scrollWidth').toBeGreaterThan(widths.code[1]!)
  expect(widths.doc[0], 'page scrollWidth').toBeLessThanOrEqual(widths.doc[1]!)
  expect(widths.chat[0], 'conversation scrollWidth').toBeLessThanOrEqual(widths.chat[1]!)

  // Blank lines stay visible: one blank line is one line height, two are two.
  const body = page.locator('.msg-user .msg-fold', { hasText: 'First paragraph.' })
  await body.scrollIntoViewIfNeeded()
  const spacing = await body.evaluate((el, text) => {
    const top = (offset: number) => {
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
      let node = walker.nextNode()!
      while (offset >= node.textContent!.length) {
        offset -= node.textContent!.length
        node = walker.nextNode()!
      }
      const range = document.createRange()
      range.setStart(node, offset)
      range.setEnd(node, offset + 1)
      return range.getBoundingClientRect().top
    }
    return { line: parseFloat(getComputedStyle(el).lineHeight),
      second: top(text.indexOf('Second')) - top(text.indexOf('\n') - 1),
      third: top(text.indexOf('Third')) - top(text.indexOf('\n', text.indexOf('Second')) - 1) }
  }, PARAGRAPHS)
  expect(spacing.second).toBeCloseTo(spacing.line * 2, 0)
  expect(spacing.third).toBeCloseTo(spacing.line * 3, 0)

  // A long typed message folds: Show more / Show less.
  const typed = page.locator('.msg-user', { hasText: 'Step 1: check' })
  await typed.scrollIntoViewIfNeeded()
  const folded = (await typed.boundingBox())!.height
  await typed.getByRole('button', { name: 'Show more' }).click()
  await expect(typed.getByRole('button', { name: 'Show less' })).toBeVisible()
  expect((await typed.boundingBox())!.height).toBeGreaterThan(folded + 100)
  await expect(typed).toContainText(LONG_TYPED.split('\n').at(-1)!)

  // The pasted log is a card that opens the whole text in a sheet, with Copy.
  const card = page.locator('.msg-user', { hasText: 'The install fails, here is the log:' }).locator('.pasted-card')
  await card.scrollIntoViewIfNeeded()
  await expect(card).toContainText('Pasted text · 40 lines')
  await card.locator('.pasted-open').click()
  const sheet = page.locator('.hw-sheet')
  await expect(sheet.locator('.pasted-full.mono')).toHaveText(PASTED_LOG)
  await expect(sheet.locator('.hw-sheet-title')).toBeInViewport()
  await sheet.getByRole('button', { name: 'Copy' }).click()
  await expect(page.locator('.hw-toast-title', { hasText: 'Text copied' })).toBeVisible()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(PASTED_LOG)
})
