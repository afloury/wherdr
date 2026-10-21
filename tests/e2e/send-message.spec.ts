import { expect, test } from '@playwright/test'
import { OMP_CHAT_PANE } from './scenario.mjs'

test('a sent message shows at once as pending, then settles into the conversation', { tag: '@webkit-phone' }, async ({ page }, testInfo) => {
  await page.goto(`/#/a/${OMP_CHAT_PANE}`)
  await expect(page.locator('.chat').getByText('Ready when you are.')).toBeVisible()

  const text = `Ship the release notes (${testInfo.project.name} ${Date.now()})`
  const field = page.locator('.prompt').locator('textarea, [contenteditable="true"]').first()
  await field.click()
  await page.keyboard.type(text)
  await page.locator('.prompt-send').click()

  // Pending bubble, before the agent took the message (the fake agent.prompt answers after 1.5 s).
  const pending = page.locator('.msg-pending', { hasText: text })
  await expect(pending).toBeVisible()
  await expect(page.locator('.msg-user-wrap', { has: pending }).locator('.queued-tag')).toContainText('sending…')

  // Settled: a plain user bubble from the transcript, then the agent's reply.
  await expect(pending).toHaveCount(0)
  const sent = page.locator('.msg-user:not(.msg-pending)', { hasText: text })
  await expect(sent).toBeVisible()
  await expect(sent).toHaveCount(1)
  await expect(page.locator('.chat').getByText('Got it.').last()).toBeVisible()
})

test('a sent line starting with ">>>" stays text; "> " lines still show as quotes', async ({ page }, testInfo) => {
  await page.goto(`/#/a/${OMP_CHAT_PANE}`)
  await expect(page.locator('.chat').getByText('Ready when you are.')).toBeVisible()

  const id = `${testInfo.project.name} ${Date.now()}`
  const field = page.locator('.prompt').locator('textarea, [contenteditable="true"]').first()
  await field.fill(`Markers ${id}\n<<<\nBody\n>>>\n> Quoted?\nYes.`)
  await page.locator('.prompt-send').click()

  const sent = page.locator('.msg-user:not(.msg-pending)', { hasText: `Markers ${id}` })
  await expect(sent).toBeVisible()
  await expect(sent.locator('.msg-q')).toHaveText(['Quoted?'])
  await expect(sent).toContainText('>>>')
  if (process.env.SHOTS) {
    await sent.scrollIntoViewIfNeeded()
    await page.screenshot({ path: `${process.env.SHOTS}/${testInfo.project.name}-markers-bubble.png` })
  }
})

test('a new message arrives as an incremental re-read, and the list matches a full reload', async ({ page }, testInfo) => {
  const replies: { keep?: number, items?: unknown[] }[] = []
  page.on('response', async (r) => {
    const u = new URL(r.url())
    if (u.pathname !== '/api/chat' || u.searchParams.get('pane') !== OMP_CHAT_PANE || u.searchParams.has('before')) return
    const body = await r.json().catch(() => null)
    if (body && body.items) replies.push(body)
  })
  await page.goto(`/#/a/${OMP_CHAT_PANE}`)
  await expect(page.locator('.chat').getByText('Ready when you are.')).toBeVisible()
  const first = replies.length

  const text = `Incremental (${testInfo.project.name} ${Date.now()})`
  const field = page.locator('.prompt').locator('textarea, [contenteditable="true"]').first()
  await field.fill(text)
  await page.locator('.prompt-send').click()
  await expect(page.locator('.msg-user:not(.msg-pending)', { hasText: text })).toHaveCount(1)
  await expect(page.locator('.chat').getByText('Got it.').last()).toBeVisible()

  // The re-read after the send carried only the new items, not the conversation.
  const later = replies.slice(first)
  expect(later.some(r => typeof r.keep === 'number' && r.keep > 0 && (r.items?.length || 0) <= 4)).toBe(true)

  // The reply is typed out progressively: wait until it is whole.
  const messages = page.locator('.chat-list .msg-user, .chat-list .msg-ai')
  await expect(messages.last()).toHaveText('Got it.')
  const live = await messages.allInnerTexts()
  await page.reload()
  await expect(page.locator('.msg-user:not(.msg-pending)', { hasText: text })).toHaveCount(1)
  await expect.poll(() => messages.allInnerTexts()).toEqual(live)
})
