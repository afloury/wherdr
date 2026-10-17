import { expect, test } from '@playwright/test'
import { COORDINATOR_PANE } from './scenario.mjs'
import { parseTasks } from '../../shared/projectBoard'

const lists = parseTasks(`## In progress
- t-0042 (Workstation, Codex): Improve keyboard navigation across the project dashboard and its task lists [b:amber(waiting)] [b:gray(t-0042)](t-0042)
## Follow-up
- demo-catalog: PR #12 is waiting for review before the next documentation update [b:amber(waiting)] [b:blue(PR #12)](https://example.com/pull/12)
- [ ] Check the export documentation [b:green(ready)]
- [x] Update the examples [b:gray(done)]
## To test
- [ ] Open the new settings panel [b:green(ready)]
`)

test('bullet tasks share card layout and draft questions to the coordinator', async ({ page }, info) => {
  await page.addInitScript(pane => {
    localStorage.setItem('viewModes', JSON.stringify({ [pane]: 'project' }))
    localStorage.setItem('herdrLanguage', 'en')
  }, COORDINATOR_PANE)
  await page.route('**/api/project?**', route => route.fulfill({ json: {
    slug: 'acme', version: 'v1', lists, open: [], resolved: [],
  } }))
  const writes: string[] = []
  page.on('request', r => {
    if (r.method() === 'POST' && /\/api\/(prompt|input)$/.test(new URL(r.url()).pathname)) writes.push(r.url())
  })
  await page.goto(`/#/a/${COORDINATOR_PANE}`)
  const tasks = page.locator('.project-panel .pp-task')
  await expect(tasks).toHaveCount(5)
  await tasks.filter({ hasText: 'demo-catalog:' }).hover()
  if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/${info.project.name}-task-bullets.png` })
  for (const task of await tasks.all()) {
    const text = task.locator('.pp-task-text')
    const foot = task.locator('.pp-task-foot')
    const textBox = (await text.boundingBox())!
    for (const badge of await foot.locator('.pp-badge').all()) {
      const b = (await badge.boundingBox())!
      expect(b.y).toBeGreaterThanOrEqual(textBox.y + textBox.height)
      expect(b.x + b.width).toBeLessThanOrEqual(textBox.x + textBox.width + 1)
    }
    await expect(foot.locator('.pp-badge')).not.toHaveCount(0)
    if (await task.evaluate(el => el.classList.contains('done'))) {
      await expect(task.locator('.pp-vbtn')).toHaveCount(0)
      continue
    }
    const title = await text.innerText()
    await task.hover()
    await task.getByRole('button', { name: `Question: ${title}`, exact: true }).click()
    await expect(page.locator('.prompt textarea').first()).toHaveValue(`↳ Question: ${title} —\n`)
    await page.locator('.prompt textarea').first().fill('')
    // A phone returns to the conversation to edit the draft. Reopen Tasks.
    await page.reload()
    await expect(tasks).toHaveCount(5)
  }
  expect(writes).toEqual([])
  await expect(page.locator('.project-panel').getByRole('link', { name: 'PR #12' })).toHaveAttribute('href', 'https://example.com/pull/12')
  expect(await page.locator('.project-panel').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
})

test('a plain bullet offers a French question draft', async ({ page }) => {
  await page.addInitScript(pane => {
    localStorage.setItem('viewModes', JSON.stringify({ [pane]: 'project' }))
    localStorage.setItem('herdrLanguage', 'fr')
  }, COORDINATOR_PANE)
  await page.route('**/api/project?**', route => route.fulfill({ json: {
    slug: 'acme', version: 'v1', lists, open: [], resolved: [],
  } }))
  await page.goto(`/#/a/${COORDINATOR_PANE}`)
  const task = page.locator('.project-panel .pp-task').filter({ hasText: 'demo-catalog:' })
  const title = await task.locator('.pp-task-text').innerText()
  await task.hover()
  await task.getByRole('button', { name: `Question : ${title}`, exact: true }).click()
  await expect(page.locator('.prompt textarea').first()).toHaveValue(`↳ Question : ${title} —\n`)
})
