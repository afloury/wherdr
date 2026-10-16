import { expect, test } from '@playwright/test'
import { CODEX_UPDATE_PANE, CODEX_UPDATE_SESSION, fakeHerdr } from './scenario.mjs'

// A Codex at work whose session Herdr does not know (its integration is not
// installed) and whose conversation cannot be found: the conversation says the
// integration is missing, with the command; once installed, the plain
// "No conversation for this agent yet." comes back.
test.afterEach(async () => {
  await fakeHerdr('e2e.integrations', { states: {} })
  await fakeHerdr('e2e.update_reset', { pane_id: CODEX_UPDATE_PANE, session: CODEX_UPDATE_SESSION })
})

test('explains a missing Herdr integration instead of "No conversation"', async ({ page }, testInfo) => {
  await fakeHerdr('e2e.integrations', { states: { codex: 'missing' } })
  // No session reported, and a folder without any Codex conversation.
  await fakeHerdr('e2e.update_reset', { pane_id: CODEX_UPDATE_PANE })
  await fakeHerdr('e2e.pane_status', { pane_id: CODEX_UPDATE_PANE, status: 'working' })
  await page.goto(`/#/a/${CODEX_UPDATE_PANE}`)

  const note = page.locator('.chat-empty.no-integration')
  await expect(note).toBeVisible({ timeout: 15000 })
  await expect(note).toContainText('Herdr\'s Codex integration is missing')
  await expect(note.locator('.no-integration-cmd')).toHaveText('herdr integration install codex')
  await expect(note.getByRole('button', { name: 'Copy command' })).toBeVisible()
  await expect(note.getByRole('button', { name: 'View terminal' })).toBeVisible()
  await expect(page.getByText('No conversation for this agent yet.')).toHaveCount(0)
  await page.screenshot({ path: `.shots/no-integration-${testInfo.project.name}.png` })

  // Integration installed (the agent not restarted yet): no more blame.
  await fakeHerdr('e2e.integrations', { states: {} })
  await expect(page.getByText('No conversation for this agent yet.')).toBeVisible({ timeout: 15000 })
  await expect(note).toHaveCount(0)
})
