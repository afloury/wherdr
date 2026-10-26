import { expect, test, type Locator } from './test'
import fs from 'node:fs/promises'

const dependency = 'staging-machine:example-project/1234567'
const task = { id: 'demo/10', repo: 'demo', n: 10, title: 'Release notes', group: 'working', state: 'working', stage: 'after', msg: `queued after ${dependency}`, app: 'codex', progress: 60 }

async function contained(badge: Locator, container: Locator) {
  await expect(badge).toBeVisible()
  const box = (await badge.boundingBox())!
  const outer = (await container.boundingBox())!
  expect(box.x).toBeGreaterThanOrEqual(outer.x)
  expect(box.x + box.width).toBeLessThanOrEqual(outer.x + outer.width + 1)
  expect(await badge.evaluate(el => getComputedStyle(el).whiteSpace)).toBe('nowrap')
  expect(await badge.evaluate(el => getComputedStyle(el).textOverflow)).toBe('ellipsis')
  await expect(badge).toHaveAttribute('title', new RegExp(dependency))
  await expect(badge).toHaveAttribute('aria-label', new RegExp(dependency))
}

for (const lang of ['en', 'fr']) {
  test(`long queued references stay inside cards and panels (${lang})`, async ({ page }) => {
    await page.addInitScript(l => localStorage.setItem('herdrLanguage', l), lang)
    await page.route('**/api/tasks**', route => {
      const url = new URL(route.request().url())
      if (url.pathname === '/api/tasks') return route.fulfill({ json: { version: 'activity-layout', machines: [{ machine: '', status: 'ready', version: '1.2.21', tasks: [task] }] } })
      if (url.pathname === '/api/tasks/details') return route.fulfill({ json: { task: { ...task, description: 'Prepare the release notes.' }, agent: null, reviewer: null, panes: [] } })
      if (url.pathname === '/api/tasks/coordinator') return route.fulfill({ json: { state: 'none', pane: null } })
      return route.fulfill({ json: { machines: [], settings: [], problems: [] } })
    })
    await fs.mkdir('.shots', { recursive: true })
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 })
      await page.goto('/#/board')
      // A phone shows one lane at a time and opens on "Yours".
      if (width === 390) await page.getByRole('button', { name: /^(Working|En cours)/ }).click()
      const card = page.locator('.task-card[data-task="demo/10"]')
      await contained(card.locator('.task-activity'), card)
      await page.screenshot({ path: `.shots/activity-board-${lang}-${width}.png` })
      await card.locator('.task-card-open').click()
      const panel = page.locator('.board-panel')
      const badge = panel.locator('.task-activity')
      await contained(badge, panel.locator('.board-panel-head'))
      const title = panel.locator('.board-panel-title')
      await expect(title).toHaveText(task.title)
      expect((await title.boundingBox())!.width).toBeGreaterThan(60)
      const titleBox = (await title.boundingBox())!
      expect((await badge.boundingBox())!.y).toBeGreaterThanOrEqual(titleBox.y + titleBox.height)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await page.screenshot({ path: `.shots/activity-panel-${lang}-${width}.png` })
    }
  })
}
