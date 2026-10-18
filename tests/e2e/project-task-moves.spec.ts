import fs from 'node:fs'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import { COORDINATOR_PANE, SOCK_FILE, fakeHerdr } from './scenario.mjs'

// Project panel › Tasks: the card menu moves a task in the real TASKS.md of the
// coordinator's folder, through the real server (local machine). A fake
// herdr-projects binary only lists no threads.
const TASKS = `# Acme

## In queue
- [ ] Ship the export (agent)
  - keep the CSV header

## To do
- [ ] Write the release notes [b:red(bug)]
- [ ] Check the docs links

## Backlog
- [ ] Try a dark logo
`

const tmpDir = () => path.dirname(fs.readFileSync(SOCK_FILE, 'utf8'))
const tasksFile = () => path.join(tmpDir(), 'home/.herdr-projects/acme/TASKS.md')

test.beforeEach(async () => {
  const root = path.join(tmpDir(), 'plugins/herdr-projects')
  const bin = path.join(root, 'target/release/herdr-projects')
  fs.mkdirSync(path.dirname(bin), { recursive: true })
  fs.writeFileSync(bin, '#!/bin/sh\necho "[]"\n', { mode: 0o755 })
  fs.writeFileSync(tasksFile(), TASKS)
  await fakeHerdr('e2e.plugins', { plugins: [{
    plugin_id: 'herdr-projects', enabled: true, version: '0.2.36', plugin_root: root,
    startup: [{ command: ['target/release/herdr-projects', 'hook'] }],
    source: { kind: 'github', owner: 'example', repo: 'herdr-projects' },
  }] })
})
test.afterEach(async () => {
  await fakeHerdr('e2e.plugins', { plugins: [] })
  fs.rmSync(tasksFile(), { force: true })
})

async function openTasks(page: import('@playwright/test').Page) {
  await page.addInitScript((pane) => {
    localStorage.setItem('viewModes', JSON.stringify({ [pane]: 'project' }))
    localStorage.setItem('herdrLanguage', 'fr')
  }, COORDINATOR_PANE)
  await page.goto(`/#/a/${COORDINATOR_PANE}`)
  // The server caches the plugin list for a minute (an earlier spec may have none).
  await expect(page.locator('.project-panel .pp-task')).toHaveCount(4, { timeout: 70_000 })
}
const task = (page: import('@playwright/test').Page, text: string) => page.locator('.project-panel .pp-task').filter({ hasText: text })
async function pick(page: import('@playwright/test').Page, text: string, entry: string) {
  await task(page, text).getByRole('button', { name: `Déplacer : ${text}` }).click()
  await page.getByText(entry, { exact: true }).last().click()
}

test('moves tasks in TASKS.md from the card menu, touching only their lines', async ({ page }, info) => {
  test.setTimeout(120_000)
  await openTasks(page)
  if (process.env.SHOTS) {
    await task(page, 'Check the docs links').getByRole('button', { name: 'Déplacer : Check the docs links' }).click()
    await page.waitForTimeout(400)
    await page.screenshot({ path: `${process.env.SHOTS}/${info.project.name}-task-menu.png` })
    await page.keyboard.press('Escape')
    await page.mouse.click(5, 5)
  }

  await pick(page, 'Check the docs links', 'Monter')
  await expect.poll(() => fs.readFileSync(tasksFile(), 'utf8')).toBe(TASKS.replace(
    '- [ ] Write the release notes [b:red(bug)]\n- [ ] Check the docs links\n',
    '- [ ] Check the docs links\n- [ ] Write the release notes [b:red(bug)]\n',
  ))
  await expect(page.locator('.project-panel .pp-task .pp-task-text').nth(1)).toHaveText('Check the docs links')

  await pick(page, 'Ship the export', 'Passer en To do')
  await expect.poll(() => fs.readFileSync(tasksFile(), 'utf8')).toBe(`# Acme

## In queue

## To do
- [ ] Ship the export (agent)
  - keep the CSV header
- [ ] Check the docs links
- [ ] Write the release notes [b:red(bug)]

## Backlog
- [ ] Try a dark logo
`)

  await pick(page, 'Try a dark logo', 'Passer en In queue')
  await expect.poll(() => fs.readFileSync(tasksFile(), 'utf8')).toContain('## In queue\n- [ ] Try a dark logo\n\n## To do')
  await expect(task(page, 'Try a dark logo')).toBeVisible()
  expect(await page.locator('.project-panel').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
})

test('refuses a move when TASKS.md changed since it was read', async ({ page }) => {
  test.setTimeout(120_000)
  await openTasks(page)
  // Same size, so the panel's light poll would not notice it yet.
  const changed = TASKS.replace('Try a dark logo', 'Try a pale logo')
  fs.writeFileSync(tasksFile(), changed)
  await pick(page, 'Check the docs links', 'Monter')
  await expect(page.locator('.hw-toast-title', { hasText: 'TASKS.md a changé entre-temps : vérifie la liste et réessaie' })).toBeVisible()
  expect(fs.readFileSync(tasksFile(), 'utf8')).toBe(changed)
  await expect(task(page, 'Try a pale logo')).toBeVisible()
})
