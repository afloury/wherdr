// Claude's /status opened in its terminal during a turn hides its input field:
// a message sent meanwhile waits, the conversation says the menu is still
// open and closes it with a single Escape.
import { readFileSync } from 'node:fs'
import { expect, test } from './test'
import { OMP_CHAT_PANE as pane, fakeHerdr } from './scenario.mjs'

const fx = (name: string) => readFileSync(new URL(`../fixtures/${name}.txt`, import.meta.url), 'utf8')

test.afterEach(async ({ request }) => {
  await fakeHerdr('e2e.interaction_screen', { pane_id: pane, text: null, agent: 'omp', status: 'idle' })
  await expect.poll(async () => (await (await request.get('/api/state')).json()).panes.find((p: { id: string }) => p.id === pane)?.agent).toBe('omp')
})

test('a menu left open during a turn is shown and closed from the conversation', async ({ page }, info) => {
  await fakeHerdr('e2e.interaction_screen', { pane_id: pane, text: fx('claude-settings-status'), agent: 'claude', status: 'working' })
  await page.goto(`/#/a/${pane}`)
  const text = `Then add a title (${info.project.name} ${Date.now()})`
  await page.locator('.prompt').locator('textarea, [contenteditable="true"]').first().fill(text)
  await page.locator('.prompt-send').click()

  const notice = page.locator('.menu-left')
  await expect(notice).toContainText('A menu is still open in the agent’s terminal')
  await expect(page.locator('.msg-user-wrap', { has: page.locator('.msg-pending', { hasText: text }) }).locator('.queued-tag')).toContainText('Queued')
  if (process.env.SHOTS) {
    await notice.scrollIntoViewIfNeeded()
    await page.screenshot({ path: `${process.env.SHOTS}/menu-left-${info.project.name}.png` })
    await page.setViewportSize({ width: 1440, height: 900 })
    await notice.scrollIntoViewIfNeeded()
    await page.screenshot({ path: `${process.env.SHOTS}/menu-left-${info.project.name}-1440.png` })
  }

  await notice.getByRole('button', { name: 'Close menu' }).click()
  await expect(notice).toHaveCount(0)
  expect((await fakeHerdr('e2e.terminal_screen', { pane_id: pane })).keys).toEqual(['esc'])
  // Still during the turn: the message waits for its end, nothing was interrupted.
  await expect(page.locator('.msg-pending', { hasText: text })).toBeVisible()
})
