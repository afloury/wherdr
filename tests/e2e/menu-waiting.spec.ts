import { expect, test } from './test'
import { OMP_CHAT_PANE as pane, fakeHerdr } from './scenario.mjs'

// Same unknown-menu shape as Claude's /hooks, including Herdr's blocked status.
const hooks = [
  '▔'.repeat(70), '   Hooks', '', '   ❯ PreToolUse', '     PostToolUse', '',
  '   ↑/↓ to navigate · Enter to confirm · Esc to cancel',
].join('\n')

test.afterEach(async () => {
  await fakeHerdr('e2e.interaction_screen', { pane_id: pane, text: null, agent: 'omp', status: 'idle' })
})

test('a blocked hooks menu has one action panel and no duplicate waiting status', async ({ page }, info) => {
  await fakeHerdr('e2e.interaction_screen', { pane_id: pane, text: hooks, agent: 'claude', status: 'blocked' })
  await page.goto(`/#/a/${pane}`)
  await expect(page.locator('.choices-menu')).toContainText('Hooks')
  await expect(page.locator('.chat-status.waiting')).toHaveCount(0)
  await expect(page.locator('.chat-empty.waiting')).toHaveCount(0)
  await page.screenshot({ path: `.shots/hooks-${info.project.name}.png` })
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.screenshot({ path: '.shots/hooks-1440.png' })
})
