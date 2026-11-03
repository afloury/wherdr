import { expect, test, type FakeCore } from './fake-core'

// Port of send-message.spec.ts to herdr-core: a Claude Code terminal whose fake agent
// writes each message, then "Got it.", into its conversation file.
const agent = (core: FakeCore) => core.claude('demo', [['user', 'Are you ready?'], ['assistant', 'Ready when you are.']], { reply: 'Got it.' })
const field = (page: import('@playwright/test').Page) => page.locator('.prompt').locator('textarea, [contenteditable="true"]').first()

test('a sent message shows at once as pending, then settles into the conversation', async ({ page, core }) => {
  const claude = agent(core)
  await page.goto(claude.url)
  await expect(page.locator('.chat').getByText('Ready when you are.')).toBeVisible()

  const text = `Ship the release notes (${Date.now()})`
  await field(page).click()
  await page.keyboard.type(text)
  await page.locator('.prompt-send').click()

  // Pending bubble, before the agent took the message.
  const pending = page.locator('.msg-pending', { hasText: text })
  await expect(pending).toBeVisible()
  await expect.poll(() => claude.sends).toEqual([text])

  // Settled: a plain user bubble from the conversation file, then the agent's reply.
  await expect(pending).toHaveCount(0)
  const sent = page.locator('.msg-user:not(.msg-pending)', { hasText: text })
  await expect(sent).toBeVisible()
  await expect(sent).toHaveCount(1)
  await expect(page.locator('.chat').getByText('Got it.').last()).toBeVisible()
})

test('a sent line starting with ">>>" stays text; "> " lines still show as quotes', async ({ page, core }) => {
  const claude = agent(core)
  await page.goto(claude.url)
  await expect(page.locator('.chat').getByText('Ready when you are.')).toBeVisible()

  const id = String(Date.now())
  await field(page).fill(`Markers ${id}\n<<<\nBody\n>>>\n> Quoted?\nYes.`)
  await page.locator('.prompt-send').click()

  const sent = page.locator('.msg-user:not(.msg-pending)', { hasText: `Markers ${id}` })
  await expect(sent).toBeVisible()
  await expect(sent.locator('.msg-q')).toHaveText(['Quoted?'])
  await expect(sent).toContainText('>>>')
})

test('a new message arrives as an incremental re-read, and the list matches a full reload', async ({ page, core }) => {
  const claude = agent(core)
  const replies: { keep?: number, items?: unknown[] }[] = []
  page.on('response', async (r) => {
    const u = new URL(r.url())
    if (u.pathname !== '/api/chat' || u.searchParams.get('pane') !== claude.pane || u.searchParams.has('before')) return
    const body = await r.json().catch(() => null)
    if (body && body.items) replies.push(body)
  })
  await page.goto(claude.url)
  await expect(page.locator('.chat').getByText('Ready when you are.')).toBeVisible()
  const first = replies.length

  const text = `Incremental (${Date.now()})`
  await field(page).fill(text)
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
