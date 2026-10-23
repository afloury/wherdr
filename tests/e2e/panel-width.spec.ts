import { expect, test } from './test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { SOCK_FILE, fakeHerdr } from './scenario.mjs'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'panel-width-'))
const home = path.join(path.dirname(fs.readFileSync(SOCK_FILE, 'utf8').trim()), 'home')
const dir = path.join(home, '.herdr-projects/data/tasks/demo/82')
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
})
test.afterAll(() => fs.rmSync(root, { recursive: true, force: true }))

test('ticket divider drags, retains its width, resets and stays absent on mobile', async ({ page }) => {
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'task.json'), JSON.stringify(row))
  fs.writeFileSync(path.join(root, 'list.json'), JSON.stringify([row]))
  fs.writeFileSync(path.join(root, 'details.json'), JSON.stringify({ task: row, agent: 'claude' }))
  await fakeHerdr('e2e.plugins', { plugins: [plugin] })
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/#/board?machine=&task=demo%2F82')
  const panel = page.locator('.board-panel')
  const handle = page.getByRole('separator', { name: 'Ticket panel width' })
  await expect(handle).toBeAttached()
  const width = () => panel.evaluate(el => el.getBoundingClientRect().width)
  await page.getByRole('group', { name: 'Board', exact: true }).getByRole('button', { name: /^Working/ }).click()
  const initial = await width()
  await page.screenshot({ path: '.shots/panel-width-before-desktop.png' })
  const x = await panel.evaluate(el => el.getBoundingClientRect().left)
  await page.mouse.move(x, 400)
  await page.mouse.down()
  await page.mouse.move(x - 150, 400, { steps: 10 })
  await page.mouse.up()
  await expect.poll(width).toBeCloseTo(initial + 150, 0)
  await page.screenshot({ path: '.shots/panel-width-after-desktop.png' })
  const wider = await width()
  const shrinkX = await panel.evaluate(el => el.getBoundingClientRect().left)
  await page.mouse.move(shrinkX, 400)
  await page.mouse.down()
  await page.mouse.move(shrinkX + 80, 400, { steps: 10 })
  await page.mouse.up()
  await expect.poll(width).toBe(wider - 80)
  const retained = await width()
  await expect.poll(() => page.evaluate(() => localStorage.getItem('boardPanelWidth'))).toBe(String(Math.round(retained)))
  await page.keyboard.press('Escape')
  await expect(panel).toHaveCount(0)
  await page.goto('/#/board?machine=&task=demo%2F82')
  await expect.poll(width).toBe(retained)
  await page.reload()
  await page.goto('/#/board?machine=&task=demo%2F82')
  await expect(handle).toBeAttached()
  await expect.poll(width).toBe(retained)
  await handle.focus()
  await page.keyboard.press('ArrowRight')
  await expect.poll(width).toBe(retained - 16)
  await page.setViewportSize({ width: 1000, height: 900 })
  await expect.poll(() => page.locator('#board').evaluate(el => el.getBoundingClientRect().width)).toBeGreaterThanOrEqual(280)
  await page.setViewportSize({ width: 1440, height: 900 })
  const resetX = await panel.evaluate(el => el.getBoundingClientRect().left)
  await page.mouse.dblclick(resetX, 400)
  await expect.poll(width).toBe(initial)
  expect(await page.evaluate(() => localStorage.getItem('boardPanelWidth'))).toBeNull()
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(handle).toHaveCount(0)
  await expect.poll(width).toBe(390)
  await page.screenshot({ path: '.shots/panel-width-phone.png' })
})
