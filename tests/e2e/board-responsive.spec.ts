import { expect, test } from './test'
import fs from 'node:fs/promises'

const task = { id: 'demo/1', repo: 'demo', n: 1, title: 'Improve compact navigation', group: 'needs', state: 'idle', stage: 'agent', msg: 'Choose the next step' }

test('Board chrome and panels follow available space, including sidebar resizing', async ({ page }) => {
  test.setTimeout(60000)
  await page.route('**/api/tasks**', route => {
    const url = new URL(route.request().url())
    if (url.pathname === '/api/tasks') return route.fulfill({ json: { version: 'responsive', machines: [{ machine: '', status: 'ready', version: '1.2.21', tasks: [task] }] } })
    if (url.pathname === '/api/tasks/details') return route.fulfill({ json: { task: { ...task, description: 'Keep the Board readable beside the conversation.' }, agent: null, reviewer: null, panes: [] } })
    if (url.pathname === '/api/tasks/coordinator') return route.fulfill({ json: { state: 'none', pane: null } })
    return route.fulfill({ json: { machines: [], settings: [], problems: [] } })
  })
  await page.goto('/#/board')
  await fs.mkdir('.shots', { recursive: true })
  const board = page.locator('#board')
  const panel = page.locator('.board-panel')
  for (const width of [390, 700, 750, 900, 1100, 1440]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 })
    await expect(page.locator('.task-card').first()).toBeVisible()
    await expect.poll(async () => {
      const size = await board.evaluate(el => el.clientWidth)
      return (await board.getAttribute('class'))!.includes('narrow') === (size < 900)
    }).toBe(true)
    // A desktop window can still have a compact Board because of the sidebar.
    if (width <= 750) await expect(board).toHaveClass(/narrow/)
    const header = board.locator('.board-top')
    expect(await header.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
    expect((await header.boundingBox())!.height).toBeLessThan(85)
    await expect(header.locator('.board-top-coord')).toBeVisible()
    expect(await board.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: `.shots/board-responsive-${width}.png` })
    await page.locator('.task-card').first().click()
    await expect(panel).toBeVisible()
    if (width < 1440) {
      await expect(panel).not.toHaveClass(/desk/)
      await expect(board).not.toHaveClass(/with-panel/)
      expect((await panel.boundingBox())!.width).toBe(width)
    } else {
      await expect(panel).toHaveClass(/desk/)
      await expect(board).toHaveClass(/with-panel/)
      expect((await board.boundingBox())!.width).toBeGreaterThanOrEqual(640)
    }
    await page.screenshot({ path: `.shots/board-responsive-${width}-panel.png` })
    if (width === 900) await page.keyboard.press('Escape')
    else await panel.getByRole('button', { name: width < 1440 ? 'Back to the Board' : 'Close', exact: true }).click()
    await expect(panel).toHaveCount(0)
  }
  // Widen the sidebar without changing the viewport; the open panel must
  // switch to an overlay and retain the task, then dock again when it fits.
  await page.locator('.task-card').first().click()
  await expect(panel).toHaveClass(/desk/)
  await page.evaluate(() => document.documentElement.style.setProperty('--side', '560px'))
  await expect(panel).not.toHaveClass(/desk/)
  await expect(panel).toContainText(task.title)
  await page.evaluate(() => document.documentElement.style.removeProperty('--side'))
  await expect(panel).toHaveClass(/desk/)
  await panel.getByRole('button', { name: 'Close', exact: true }).click()
  // Reproduce a narrow desktop Board with the full sidebar still present.
  await page.setViewportSize({ width: 750, height: 900 })
  await page.evaluate(() => document.documentElement.style.setProperty('--side', '340px'))
  await expect(board).toHaveClass(/narrow/)
  await expect.poll(async () => (await board.boundingBox())!.width).toBe(410)
  expect(await board.locator('.board-top').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
  await page.screenshot({ path: '.shots/board-responsive-750-full-sidebar.png' })
  await page.locator('.task-card').first().click()
  await expect(panel).not.toHaveClass(/desk/)
  await page.screenshot({ path: '.shots/board-responsive-750-full-sidebar-panel.png' })
  await panel.getByRole('button', { name: 'Back to the Board', exact: true }).click()
  await page.evaluate(() => document.documentElement.style.removeProperty('--side'))
  // Settings use the same overlay policy.
  await page.setViewportSize({ width: 900, height: 900 })
  await page.getByRole('button', { name: 'Board settings', exact: true }).click()
  await expect(page.locator('.board-settings')).not.toHaveClass(/desk/)
  await page.keyboard.press('Escape')
  await expect(page.locator('.board-settings')).toHaveCount(0)
})
