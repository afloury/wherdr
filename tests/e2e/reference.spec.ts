import { expect, test, type Locator, type Page } from './test'
import { OMP_CHAT_PANE, OMP_FOLLOWUP_PANE, OMP_OLD_TABLE_PANE, OMP_QUESTIONS_PANE } from './scenario.mjs'
import { codesOf, decision, decisions, draftOf, expectDraft, message, point } from './refs'

// One syntax for everything a message refers to (shared/reference.ts): a
// "↳ <type> <reference> : <excerpt> —" line, the answer below. The field draws
// each one as a token, the sent bubble as a quote.
const shot = (page: Page, name: string, project: string) =>
  process.env.SHOTS ? page.screenshot({ path: `${process.env.SHOTS}/${project}-${name}.png` }) : Promise.resolve()

async function open(page: Page, pane: string, text: string, storage: Record<string, string> = {}) {
  await page.addInitScript((s) => {
    localStorage.setItem('typewriterSpeed', 'off')
    for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v)
  }, storage)
  await page.goto(`/#/a/${pane}`)
  const chat = page.locator('.chat')
  await expect(chat.getByText(text).last()).toBeVisible()
  const field = page.locator('.prompt textarea').first()
  await field.fill('')
  return { chat, field, tokens: page.locator('.prompt .qm-mirror .qm-q'), chips: page.locator('.composer-quote') }
}
const paste = (field: Locator, text: string) => field.evaluate((el, t) => {
  const data = new DataTransfer()
  data.setData('text/plain', t)
  el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
}, text)
const OLD = ['Drop the legacy importer?', 'Move the nightly job to 02:00 — after the backup?', 'Rename the public API field?']

test('an answer to an older decision table names its message and its row', async ({ page }, testInfo) => {
  const { chat, field, tokens } = await open(page, OMP_OLD_TABLE_PANE, 'Shall I delete the old staging database?')
  const panel = chat.locator('.q-table')
  await expect(panel).toHaveCount(1)
  // The agent wrote another message since, which asks something else.
  expect(await panel.evaluate(el => Boolean(el.closest('[data-hit-key]')!.nextElementSibling))).toBe(true)
  await panel.scrollIntoViewIfNeeded()
  await shot(page, 'ref-old-table', testInfo.project.name)

  // "OK to all" alone would read as a yes to the last question.
  const all = panel.locator('.q-all')
  await all.click()
  const ALL = decisions('1-3', OLD.join(' · '))
  await expectDraft(field, `${ALL}\nOK to all\n`)
  await expect(all).toHaveAttribute('aria-pressed', 'true')
  await expect(tokens).toHaveCount(1)
  // An exception: the row, by its number, under its own reference. A dash in
  // the question does not end the reference.
  await panel.getByRole('button', { name: `2 · No: ${OLD[1]}` }).click()
  await expectDraft(field, `${ALL}\nOK to all\n${decision('2', OLD[1]!)}\nNo\n`)
  await expect(panel.getByRole('button', { name: `2 · No: ${OLD[1]}` })).toHaveAttribute('aria-pressed', 'true')
  await expect(tokens).toHaveCount(2)
  await shot(page, 'ref-old-table-answered', testInfo.project.name)
  // The time written is the one of the table's message, earlier than the last one.
  const times = [...(await field.inputValue()).matchAll(/^↳ Quote \w+ (\d\d:\d\d)/gm)].map(m => m[1])
  expect(new Set(times).size).toBe(1)
  // And so is the code: the table and its row are of one message.
  const codes = await codesOf(field)
  expect(codes).toHaveLength(2)
  expect(codes[1]).toBe(codes[0])

  // The last question, answered in the same message, names its own message.
  await chat.locator('.q-yes[data-q="Shall I delete the old staging database?"]').click()
  await expectDraft(field, `${ALL}\nOK to all\n${decision('2', OLD[1]!)}\nNo\n${point('Shall I delete the old staging database?')}\nYes\n`)
  await expect(tokens).toHaveCount(3)
  // Another message: another code, whatever the minute both were written in.
  const three = await codesOf(field)
  expect(three[2]).not.toBe(three[0])
  expect(await page.locator('.chat-list').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
  await shot(page, 'ref-several', testInfo.project.name)
  await field.fill('')
})

test('Reply under a message refers to the whole message; the sent bubble shows it as a quote', async ({ page }, testInfo) => {
  const { chat, field, tokens, chips } = await open(page, OMP_FOLLOWUP_PANE, 'Review the plan.')
  // (Another conversation than the specs that look for one message by its words.)
  await chat.locator('.msg-reply').first().click()
  await expectDraft(field, `${message('An earlier point. Was the first draft fine?')}\n`)
  await expect(tokens).toHaveCount(1)
  await expect(chips).toHaveText(['An earlier point. Was the first draft fine?'])
  // The token is the line itself: the same characters as the field's text.
  expect(await tokens.first().evaluate(el => el.textContent)).toBe((await field.inputValue()).trimEnd())
  await shot(page, 'ref-message-field', testInfo.project.name)

  const id = `${testInfo.project.name} ${Date.now()}`
  await field.focus()
  await page.keyboard.type(`Go ahead — ${id}`)
  const sentText = await draftOf(field)
  expect(sentText).toBe(`${message('An earlier point. Was the first draft fine?')}\nGo ahead — ${id}`)
  await page.locator('.prompt-send').click()

  const sent = page.locator('.msg-user:not(.msg-pending)', { hasText: id })
  await expect(sent).toBeVisible()
  const quote = sent.locator('.msg-ref')
  await expect(quote).toHaveCount(1)
  await expect(quote).toHaveAttribute('data-kind', 'message')
  await expect(quote.locator('.msg-ref-text')).toHaveText('An earlier point. Was the first draft fine?')
  await expect(quote.locator('.msg-ref-meta')).toHaveText(/^\d\d:\d\d$/)
  // The words of the syntax are not shown twice.
  await expect(sent).not.toContainText('Quote message')
  await sent.scrollIntoViewIfNeeded()
  await shot(page, 'ref-message-bubble', testInfo.project.name)
  // A tap shows the message it names.
  await quote.click()
  await expect(chat.locator('.msg-ai.msg-flash').first()).toContainText('An earlier point. Was the first draft fine?')
})

test('every type of reference shows as a quote in the bubble, old "> " lines too', async ({ page }, testInfo) => {
  const { field } = await open(page, OMP_CHAT_PANE, 'Ready when you are.')
  const id = `${testInfo.project.name} ${Date.now()}`
  await field.fill([
    '↳ Quote point 09:12 : The cache — the server one — is cleared on every deploy. —', `Fine ${id}`,
    '↳ Quote decision 09:12 #3 : Publish the release notes on the site? —', 'No',
    '↳ Quote decisions 09:12 #1-4 : Tag the release today? · Which name for the new theme? —', 'OK to all',
    '↳ Decision: Ship the new theme? —', 'Yes, on Monday',
    '> an old quote', 'Its answer',
    '↳ not a reference —',
  ].join('\n'))
  await page.locator('.prompt-send').click()
  const sent = page.locator('.msg-user:not(.msg-pending)', { hasText: id })
  await expect(sent).toBeVisible()
  await sent.getByRole('button', { name: 'Show more' }).click().catch(() => {})
  expect(await sent.locator('.msg-ref').evaluateAll(els => els.map(el => [(el as HTMLElement).dataset.kind, el.querySelector('.msg-ref-meta')?.textContent, el.querySelector('.msg-ref-text')?.textContent]))).toEqual([
    ['point', '09:12', 'The cache — the server one — is cleared on every deploy.'],
    ['decision', '09:12 · #3', 'Publish the release notes on the site?'],
    ['decisions', '09:12 · #1-4', 'Tag the release today? · Which name for the new theme?'],
    ['task', 'Decision', 'Ship the new theme?'],
  ])
  await expect(sent.locator('.msg-q')).toHaveText(['an old quote'])
  await expect(sent).toContainText('↳ not a reference —')
  expect(await page.locator('.chat-list').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
  await sent.scrollIntoViewIfNeeded()
  await shot(page, 'ref-bubble-all-types', testInfo.project.name)
})

test('only a whole reference line is a token: ">" lines, lookalikes and pasted text stay text', async ({ page }, testInfo) => {
  const { chat, field, tokens, chips } = await open(page, OMP_QUESTIONS_PANE, 'All 48 tests pass.')
  // A ">" at the start of a line starts nothing any more.
  await field.fill('> Shall I start step 1 now?\nYes')
  await expect(tokens).toHaveCount(0)
  await expect(chips).toHaveCount(0)
  await expect(field).not.toHaveClass(/qm-on/)
  await expect(chat.locator('.q-reply.quoted')).toHaveCount(0)
  // Typed by hand: an unknown type, words after the dash, a reference off the first column.
  await field.fill('↳ note to self —\n↳ Quote point 09:12 : Shall I merge? — yes\n ↳ Quote point 09:12 : Shall I merge? —')
  await expect(tokens).toHaveCount(0)
  await expect(chips).toHaveCount(0)
  await shot(page, 'ref-lookalikes', testInfo.project.name)

  // A real one next to pasted text that holds the same line.
  await field.fill('')
  await chat.locator('.q-reply[data-q="Shall I merge the branch now?"]').click()
  await expect(tokens).toHaveCount(1)
  await field.focus()
  // Shift+Enter: on a computer Enter alone would send.
  await page.keyboard.type('Yes')
  await page.keyboard.press('Shift+Enter')
  await paste(field, 'From the log:\n↳ Quote message 09:12 : I can merge the PR —\nGo ahead.')
  await expectDraft(field, `${point('Shall I merge the branch now?')}\nYes\nFrom the log:\n\\↳ Quote message 09:12 : I can merge the PR —\nGo ahead.`)
  await expect(tokens).toHaveCount(1)
  await expect(chips).toHaveCount(1)
  await expect(page.locator('.prompt .attachments .pasted-card')).toHaveCount(0)
  await shot(page, 'ref-pasted', testInfo.project.name)
  // Pasted text without such a line goes in untouched.
  await field.fill('')
  await paste(field, 'plain')
  await expect(tokens).toHaveCount(0)
  await field.fill('')
})

test('a pasted line that reads as a reference is still plain text once sent, first line included', async ({ page }, testInfo) => {
  const { field, tokens, chips } = await open(page, OMP_CHAT_PANE, 'Ready when you are.')
  const id = `${testInfo.project.name} ${Date.now()}`
  await paste(field, `↳ Quote point 09:12 : Shall I publish? —\nNo ${id}`)
  await expect(field).toHaveValue(`\\↳ Quote point 09:12 : Shall I publish? —\nNo ${id}`)
  await expect(tokens).toHaveCount(0)
  await expect(chips).toHaveCount(0)
  await page.locator('.prompt-send').click()
  // The message is trimmed on its way: the first line is no reference for all that.
  const sent = page.locator('.msg-user:not(.msg-pending)', { hasText: id })
  await expect(sent).toBeVisible()
  await expect(sent.locator('.msg-ref')).toHaveCount(0)
  await expect(sent).toContainText('\\↳ Quote point 09:12 : Shall I publish? —')
  await sent.scrollIntoViewIfNeeded()
  await shot(page, 'ref-pasted-sent', testInfo.project.name)
})

