// "Restart to update": Claude exits then restarts in the same pane. While
// Herdr still reports it during its exit, the conversation stays as it is:
// no interactive terminal opens then closes on its own.
import { expect, test } from './test'
import { OMP_CHAT_PANE as pane, fakeHerdr } from './scenario.mjs'

const RULE = '─'.repeat(60)
const FIELD = `\n${RULE}\n❯ \n${RULE}\n  ? for shortcuts`
const EXITING = '❯ /exit\n  ⎿  Goodbye!\n\nResume this session with:\nclaude --resume 00000000-0000-4000-8000-000000000000\nuser@host demo % '
const show = (text: string | null, agent = 'claude', status = 'idle') =>
  fakeHerdr('e2e.interaction_screen', { pane_id: pane, text, agent, status })

test.afterEach(async () => {
  await fakeHerdr('e2e.slow_exit', { pane_id: pane })
  await show(null, 'omp')
})

test('restarting the agent keeps the conversation without opening the terminal', async ({ page }) => {
  await show(FIELD)
  await page.goto(`/#/a/${pane}`)
  await expect.poll(async () => (await (await page.request.get('/api/state')).json()).panes.find((p: { id: string }) => p.id === pane)?.interaction).toBe('input')
  await expect(page.locator('.composer')).toBeVisible()
  // Record any appearance of the modal, however brief.
  await page.evaluate(() => {
    const w = window as unknown as { terminalSeen: boolean }
    w.terminalSeen = false
    new MutationObserver(() => { if (document.querySelector('.interactive-terminal')) w.terminalSeen = true })
      .observe(document.body, { childList: true, subtree: true })
  })
  await fakeHerdr('e2e.slow_exit', { pane_id: pane, ms: 2500, screen: EXITING, after: FIELD })
  const r = await page.request.post('/api/restart', { headers: { Origin: new URL(page.url()).origin }, data: { pane_id: pane } })
  expect(r.ok()).toBe(true)
  await expect(page.locator('.composer-notice.restart')).toBeVisible()
  await expect.poll(async () => (await fakeHerdr('e2e.update_starts', { pane_id: pane })).starts.length, { timeout: 20000 }).toBe(1)
  await expect(page.locator('.composer-notice.restart')).toHaveCount(0, { timeout: 15000 })
  // Past the 500 ms debounce of the terminal on the new agent's field.
  await page.waitForTimeout(1500)
  expect(await page.evaluate(() => (window as unknown as { terminalSeen: boolean }).terminalSeen)).toBe(false)
  await expect(page.locator('.interactive-terminal')).toHaveCount(0)
  await expect(page.locator('.composer')).toBeVisible()
})
