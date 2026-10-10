import { expect, test } from '@playwright/test'
import { OMP_CHAT_PANE } from './scenario.mjs'

test('a sent message shows at once as pending, then settles into the conversation', async ({ page }, testInfo) => {
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

test('a sent line starting with ">>>" stays text; only "> " lines are quotes', async ({ page }, testInfo) => {
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
