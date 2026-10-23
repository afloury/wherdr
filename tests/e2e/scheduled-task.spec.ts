import { expect, test, type Page } from './test'
import { CLAUDE_SUGGEST_PANE, SCHEDULED_PROMPT, SCHEDULED_REPLY, SUGGEST_PLAIN } from './scenario.mjs'

// A prompt a Claude Code scheduled task sent (CronCreate) is shown in its
// place, folded, as a "Scheduled task": never the user's bubble, never a
// "Queued · sending…" one under the agent's reply, even though Claude left
// its enqueue line open. The grayed-out suggestion in the field is not text.
const shot = (page: Page, name: string, project: string) =>
  process.env.SHOTS ? page.screenshot({ path: `${process.env.SHOTS}/${project}-${name}.png` }) : Promise.resolve()

test('a scheduled task: folded in its place, not queued', { tag: '@chromium-desktop' }, async ({ page, isMobile }, testInfo) => {
  await page.addInitScript(() => localStorage.setItem('typewriterSpeed', 'off'))
  await page.goto(`/#/a/${CLAUDE_SUGGEST_PANE}`)
  const task = page.locator('.msg-scheduled')
  await expect(task).toHaveCount(1, { timeout: 15_000 })
  await expect(task.locator('.msg-scheduled-label')).toHaveText('Scheduled task')
  await expect(task.locator('.msg-scheduled-body')).toHaveCount(0)
  await expect(task.locator('.msg-scheduled-peek')).toContainText('Look at the nightly build')

  // Between the earlier reply and its own reply, in the order of the transcript.
  const y = async (l: ReturnType<Page['locator']>) => (await l.first().boundingBox())!.y
  const earlier = page.locator('.chat').getByText('A flaky network test timed out', { exact: false })
  const own = page.locator('.chat').getByText(SCHEDULED_REPLY, { exact: false })
  expect(await y(earlier)).toBeLessThan(await y(task))
  expect(await y(task)).toBeLessThan(await y(own))

  // No bubble of the user with its text, no pending bubble at all.
  await expect(page.locator('.msg-user-wrap').filter({ hasText: 'Look at the nightly build' })).toHaveCount(0)
  await expect(page.locator('.msg-pending')).toHaveCount(0)
  await expect(page.getByText('sending…')).toHaveCount(0)

  // The field: empty, the suggestion only as its placeholder.
  const field = page.locator('.prompt textarea').first()
  await expect(field).toHaveAttribute('placeholder', SUGGEST_PLAIN)
  await expect(field).toHaveValue('')
  await shot(page, 'scheduled-folded', testInfo.project.name)

  // Opened on a tap: the whole prompt.
  const head = task.locator('.msg-scheduled-head')
  if (isMobile) await head.tap()
  else await head.click()
  await expect(head).toHaveAttribute('aria-expanded', 'true')
  await expect(task.locator('.msg-scheduled-body')).toHaveText(SCHEDULED_PROMPT)
  await task.scrollIntoViewIfNeeded()
  await shot(page, 'scheduled-open', testInfo.project.name)
  // No horizontal scroll on a phone.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})

test('in French: Tâche planifiée', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('typewriterSpeed', 'off')
    localStorage.setItem('herdrLanguage', 'fr')
  })
  await page.goto(`/#/a/${CLAUDE_SUGGEST_PANE}`)
  await expect(page.locator('.msg-scheduled-label')).toHaveText('Tâche planifiée', { timeout: 15_000 })
})
