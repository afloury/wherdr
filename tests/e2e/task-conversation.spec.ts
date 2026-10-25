import { expect, test } from './test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fakeHerdr } from './scenario.mjs'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'conversation-'))
const row = { id: 'demo/95', title: 'Discuss the navigation', app: 'codex', state: 'blocked', stage: 'asks', kind: 'question', chat: true, msg: 'Which layout should we choose?' }
fs.mkdirSync(path.join(root, 'bin'))
fs.writeFileSync(path.join(root, 'list.json'), JSON.stringify([row]))
fs.writeFileSync(path.join(root, 'details.json'), JSON.stringify({ task: row, chat: true, agent: 'codex' }))
fs.writeFileSync(path.join(root, 'bin/run.sh'), `#!/bin/sh
case "$1" in
list) cat '${root}/list.json';;
details) cat '${root}/details.json';;
show) echo '{"settings":[],"problems":[]}';;
coordinator) echo '{"state":"none","pane":""}';;
*) echo ok;;
esac
`, { mode: 0o755 })
const plugin = { plugin_id: 'herdr-projects', enabled: true, version: '1.2.16', plugin_root: root, startup: [{ command: ['sh', 'bin/run.sh', 'hook'] }], actions: [{ id: 'open', command: ['sh', 'bin/run.sh', 'open'] }] }
test.afterEach(async () => { await fakeHerdr('e2e.plugins', { plugins: [] }) })
test.afterAll(() => fs.rmSync(root, { recursive: true, force: true }))

test('conversation badge and finish action fit phone and desktop', async ({ page }) => {
  await fakeHerdr('e2e.plugins', { plugins: [plugin] })
  await page.goto('/#/board?machine=&task=demo%2F95')
  const panel = page.locator('.board-panel')
  await expect(panel.getByRole('button', { name: 'End conversation', exact: true }).first()).toBeVisible()
  await expect(panel.locator('.task-chip').filter({ hasText: 'Conversation' }).first()).toBeVisible()
  await expect(page.locator('.task-card[data-task="demo/95"] .task-chip').filter({ hasText: 'Conversation' })).toHaveText('Conversation')
  await expect(panel.getByRole('button', { name: 'Approve', exact: true })).toHaveCount(0)
  for (const [name, width, height] of [['phone', 390, 844], ['desktop', 1440, 900]] as const) {
    await page.setViewportSize({ width, height })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: `.shots/conversation-${name}.png` })
  }
})
