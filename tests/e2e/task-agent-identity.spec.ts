import { expect, test } from './test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { CLAUDE_PANE, CLAUDE_ASK_PANE, CODEX_UPDATE_PANE, SOCK_FILE, fakeHerdr } from './scenario.mjs'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'identity-'))
const home = path.join(path.dirname(fs.readFileSync(SOCK_FILE, 'utf8').trim()), 'home')
const dir = path.join(home, '.herdr-projects/data/tasks/demo/82')
const fallbackDir = path.join(home, '.herdr-projects/data/tasks/demo/83')
const fallback = { id: 'demo/83', title: 'Cache product images', app: 'claude', agent: 'claude', on: 'claude/opus', stage: 'working', state: 'working', handovers: [{ role: 'worker', from: 'codex/gpt', to: 'claude/opus' }] }
const row = { id: 'demo/82', title: 'Improve product search', app: 'codex', agent: 'claude', stage: 'reviewing', state: 'working' }
fs.mkdirSync(path.join(root, 'bin'))
fs.writeFileSync(path.join(root, 'bin/run.sh'), `#!/bin/sh
case "$1" in
list) cat '${root}/list.json';;
details) case "$4" in demo/83) cat '${root}/fallback.json';; *) cat '${root}/details.json';; esac;;
coordinator) echo '{"state":"none","pane":""}';;
show) echo '{"settings":[],"problems":[]}';;
*) echo ok;;
esac
`, { mode: 0o755 })
const plugin = { plugin_id: 'herdr-projects', enabled: true, version: '1.2.1', plugin_root: root, startup: [{ command: ['sh', 'bin/run.sh', 'hook'] }], actions: [{ id: 'open', command: ['sh', 'bin/run.sh', 'open'] }] }

test.afterEach(async () => {
  await fakeHerdr('e2e.plugins', { plugins: [] })
  fs.rmSync(dir, { recursive: true, force: true })
  fs.rmSync(fallbackDir, { recursive: true, force: true })
})
test.afterAll(() => fs.rmSync(root, { recursive: true, force: true }))

test('worker identity stays consistent during review on Home, Board and conversation', async ({ page }) => {
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'task.json'), JSON.stringify({ ...row, link: { pane: CLAUDE_PANE, workspace: 'w1', ownsWorkspace: true, reviewer: { pane: CODEX_UPDATE_PANE, kind: 'codex' } } }))
  fs.mkdirSync(fallbackDir, { recursive: true })
  fs.writeFileSync(path.join(fallbackDir, 'task.json'), JSON.stringify({ ...fallback, link: { pane: CLAUDE_ASK_PANE, workspace: 'w12', ownsWorkspace: true } }))
  fs.writeFileSync(path.join(root, 'fallback.json'), JSON.stringify({ task: fallback, agent: 'claude' }))
  fs.writeFileSync(path.join(root, 'list.json'), JSON.stringify([row, fallback]))
  fs.writeFileSync(path.join(root, 'details.json'), JSON.stringify({ task: row, agent: 'claude' }))
  await fakeHerdr('e2e.plugins', { plugins: [plugin] })
  await page.goto('/')
  const homeRow = page.locator('.task-row').filter({ hasText: row.title }).first()
  await expect(homeRow.locator(':scope > .avatar')).toHaveClass(/claude/)
  await expect(homeRow.locator('.task-agent-reviewer .avatar')).toHaveClass(/codex/)
  const fallbackRow = page.locator('.task-row').filter({ hasText: fallback.title })
  await expect(fallbackRow.locator(':scope > .avatar')).toHaveClass(/claude/)
  await expect(fallbackRow.locator('.task-agent-from .avatar')).toHaveClass(/codex/)
  await page.screenshot({ path: '.shots/identity-home-phone.png' })
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.screenshot({ path: '.shots/identity-home-desktop.png' })
  await page.goto('/#/board?machine=&task=demo%2F82')
  const panel = page.locator('.board-panel')
  await expect(panel.locator('.board-panel-name > .avatar')).toHaveClass(/claude/)
  await expect(panel.locator('.task-agent-reviewer .avatar')).toHaveClass(/codex/)
  await expect(panel.locator('.task-review-context')).toContainText('Claude’s conversation')
  const card = page.locator('.task-card[data-task="demo/82"]')
  await expect(card.locator('.task-agent-primary .avatar')).toHaveClass(/claude/)
  await expect(card.locator('.task-agent-reviewer .avatar')).toHaveClass(/codex/)
  await page.getByRole('group', { name: 'Board', exact: true }).getByRole('button', { name: /^Working/ }).click()
  await page.screenshot({ path: '.shots/identity-review-desktop.png' })
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await panel.locator('.board-panel-who > .task-agent-mark').evaluate(el => {
    const bounds = el.closest('.board-panel-head')!.getBoundingClientRect()
    return [el, ...el.querySelectorAll('span, .avatar')].every(child => {
      const rect = child.getBoundingClientRect()
      return rect.left >= bounds.left && rect.right <= bounds.right
    })
  })).toBe(true)
  await page.screenshot({ path: '.shots/identity-review-phone.png' })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await panel.getByRole('button', { name: 'Open reviewer terminal', exact: true }).click()
  await expect(panel.locator('.board-panel-tab-reviewer')).toHaveAttribute('aria-pressed', 'true')
  await expect(panel.getByRole('textbox', { name: 'Terminal input', exact: true })).toBeVisible()
  await page.goto('/#/board?machine=&task=demo%2F83')
  await expect(panel.locator('.board-panel-name > .avatar')).toHaveClass(/claude/)
  await expect(panel.locator('.task-agent-from .avatar')).toHaveClass(/codex/)
  await expect(panel.locator('.task-agent-reviewer')).toHaveCount(0)
  await expect(panel.locator('.task-review-context')).toHaveCount(0)
  await page.screenshot({ path: '.shots/identity-fallback-phone.png' })
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.screenshot({ path: '.shots/identity-fallback-desktop.png' })
})
