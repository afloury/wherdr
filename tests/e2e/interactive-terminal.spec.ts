import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { OMP_CHAT_PANE, fakeHerdr } from './scenario.mjs'

const pane = OMP_CHAT_PANE
const usage = readFileSync(new URL('../fixtures/codex-usage-menu.txt', import.meta.url), 'utf8')
const screen = (text: string | null, agent = 'codex') => fakeHerdr('e2e.interaction_screen', { pane_id: pane, text, agent, status: 'idle' })
const original = { cols: 120, rows: 40, attached: false }
const size = () => fakeHerdr('e2e.pane_size', { pane_id: pane })

test.beforeEach(async ({ page }) => {
  await expect.poll(size, { timeout: 15_000 }).toEqual(original)
  await screen(usage)
  await page.addInitScript(() => localStorage.setItem('terminalRenderer', 'html'))
  await page.goto(`/#/a/${pane}`)
})
test.afterEach(async () => { await screen(null, 'omp') })

test('shows only the live TUI, sends real keys and closes when its field returns', async ({ page }, info) => {
  const window = page.getByRole('region', { name: 'Interactive terminal', exact: true })
  await expect(window).toBeVisible()
  await expect(window.locator('.xterm-rows')).toContainText('View analytics')
  await expect(page.locator('.choices')).toHaveCount(0)
  await expect(page.locator('.hw-sheet')).toHaveCount(0)
  await expect(page.locator('.composer')).toHaveCount(0)
  const fitted = await size() as { cols: number, rows: number, attached: boolean }
  expect(fitted.attached).toBe(true)
  expect(fitted.cols).not.toBe(original.cols)
  if (info.project.name === 'chromium-phone') expect(fitted.cols).toBeLessThan(60)
  await page.screenshot({ path: `.shots/interactive-terminal-${info.project.name}.png` })
  await window.getByRole('button', { name: '↓', exact: true }).click()
  await window.getByRole('button', { name: '⏎', exact: true }).click()
  await expect.poll(async () => (await fakeHerdr('e2e.terminal_screen', { pane_id: pane }) as { keys: string[] }).keys).toEqual(['down', 'enter'])
  await window.getByRole('button', { name: 'esc', exact: true }).click()
  await expect(window).toHaveCount(0)
  await expect(page.locator('.composer')).toBeVisible()
  await expect.poll(size, { timeout: 15_000 }).toEqual(original)
})

test('manual close releases the pane without Escape and does not reopen the same screen', async ({ page }) => {
  const window = page.getByRole('region', { name: 'Interactive terminal', exact: true })
  await expect(window).toBeVisible()
  await window.getByRole('button', { name: 'Close terminal window' }).click()
  await expect(window).toHaveCount(0)
  await expect.poll(size, { timeout: 15_000 }).toEqual(original)
  expect((await fakeHerdr('e2e.terminal_screen', { pane_id: pane }) as { keys: string[] }).keys).toEqual([])
  // More than a screen re-read interval; cursor motion is still the same episode.
  await screen(usage.replace('› 1.', '  1.').replace('  2.', '› 2.'))
  await page.waitForTimeout(3500)
  await expect(window).toHaveCount(0)
  await page.getByRole('button', { name: 'Open interactive terminal' }).click()
  await expect(window).toBeVisible()
  await window.getByRole('button', { name: 'esc', exact: true }).click()
  await expect(window).toHaveCount(0)
})

test('rejects a stale native choice after the screen changes to an ambiguous menu', async ({ page }) => {
  await expect(page.locator('.interactive-terminal')).toBeVisible()
  const response = await page.request.post('/api/choose', {
    headers: { Origin: new URL(page.url()).origin },
    data: { pane_id: pane, index: 0, label: 'View analytics  Usage history' },
  })
  expect(response.ok()).toBe(false)
  expect((await fakeHerdr('e2e.terminal_screen', { pane_id: pane }) as { keys: string[] }).keys).toEqual([])
})
