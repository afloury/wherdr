import { expect, test } from './test'
import { CODEX_IMAGE_LITERAL, CODEX_IMAGE_PANE, CODEX_IMAGE_TEXT } from './scenario.mjs'

// Codex writes each photo between '<image name=[Image #1] path="…">' and
// '</image>' parts and keeps "[Image #1]" in the text: the conversation shows
// the photos only, the user's own text whole.
test('codex photos show without their markers', { tag: ['@chromium-desktop'] }, async ({ page }, info) => {
  await page.goto(`/#/a/${CODEX_IMAGE_PANE}`)
  const chat = page.locator('.chat')
  await expect(chat.getByText('Noted.')).toBeVisible()
  const users = chat.locator('.msg-user')
  await expect(users).toHaveCount(3)

  // Photo only: the thumbnail, no bubble.
  const alone = users.nth(0)
  await expect(alone).toHaveClass(/msg-no-text/)
  await expect(alone.locator('img')).toHaveCount(1)
  await expect.poll(() => alone.locator('img').evaluate(img => (img as HTMLImageElement).naturalWidth)).toBe(240)
  await expect(alone.locator('.msg-bubble')).toBeHidden()

  // Two photos and text: both photos, the text as typed.
  const mixed = users.nth(1)
  await expect(mixed.locator('img')).toHaveCount(2)
  await expect(mixed.locator('.msg-fold')).toHaveText(CODEX_IMAGE_TEXT)

  // Markers the user typed stay.
  await expect(users.nth(2).locator('.msg-fold')).toHaveText(CODEX_IMAGE_LITERAL)
  await expect(chat).not.toContainText('path=')
  expect(await chat.innerText()).not.toMatch(/<\/image>\s*\[Image #1\]/)

  if (process.env.SHOTS) {
    await alone.scrollIntoViewIfNeeded()
    await page.screenshot({ path: `${process.env.SHOTS}/${info.project.name}-codex-images.png` })
  }
})
