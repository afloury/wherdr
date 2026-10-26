import { expect, test } from './test'
import fs from 'node:fs/promises'

test('new task types fit phone and desktop and produce exclusive requests', async ({ page }) => {
  const calls: Record<string, unknown>[] = []
  await page.route('**/api/tasks**', async route => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/tasks/add') {
      calls.push(route.request().postDataJSON())
      return route.fulfill({ json: { ok: true, msg: 'Added' } })
    }
    if (path === '/api/tasks') return route.fulfill({ json: { version: 'types', machines: [{ machine: '', status: 'ready', version: '1.2.21', tasks: [] }] } })
    return route.fulfill({ json: { state: 'none', pane: null } })
  })
  await page.goto('/#/board')
  await fs.mkdir('.shots', { recursive: true })
  for (const [index, type] of ['work', 'research', 'chat'].entries()) {
    await page.getByRole('button', { name: 'New task', exact: true }).click()
    await expect(page.locator('[data-task-type="work"]')).toHaveAttribute('aria-pressed', 'true')
    await page.locator('[data-task-type="' + type + '"]').click()
    await expect(page.locator('[data-task-type][aria-pressed="true"]')).toHaveCount(1)
    await page.locator('#new-task-title').fill('Compare options')
    if (index === 0) {
      await page.screenshot({ path: '.shots/new-task-type-phone.png' })
      await page.setViewportSize({ width: 1440, height: 900 })
      await page.screenshot({ path: '.shots/new-task-type-desktop.png' })
      await page.setViewportSize({ width: 390, height: 844 })
    }
    if (index === 2) await page.getByRole('switch').click()
    await page.getByRole('button', { name: index === 2 ? 'Add and start' : 'Add to To do', exact: true }).click()
    await expect.poll(() => calls.length).toBe(index + 1)
    expect(calls[index]).toMatchObject({ machine: '', repo: '', type, delegate: index === 2 })
  }
})
