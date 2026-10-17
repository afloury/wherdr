import { expect, test } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { CLAUDE_PANE, SOCK_FILE, fakeHerdr } from './scenario.mjs'

// herdr-projects 1.x on the Board and in Settings. The plugin's launcher
// (bin/run.sh) is a fake that answers with the real output of the 1.2.1
// release (tests/recordings/herdr-projects-1.2.1) and writes down each call.
const fixtures = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../recordings/herdr-projects-1.2.1')
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wherdr-hp1x-'))
const calls = path.join(root, 'calls.log')
fs.mkdirSync(path.join(root, 'bin'))
fs.writeFileSync(path.join(root, 'bin/run.sh'), `#!/bin/sh
printf '%s\\n' "$*" >> '${calls}'
case "$1" in
  list) cat '${fixtures}/list.json' ;;
  details) case "$4" in demo/1) cat '${fixtures}/details-approval.json' ;; demo/2) cat '${fixtures}/details-asks.json' ;; *) cat '${fixtures}/details-working.json' ;; esac ;;
  tell) echo "$3: sent" ;;
  approve) echo "$3: approved, merging" ;;
  coordinator) echo "sent to the Coordinator" ;;
  *) echo "unexpected: $*" >&2; exit 1 ;;
esac
`, { mode: 0o755 })

const manifest = (version: string, launcher = true) => ({
  plugin_id: 'herdr-projects', enabled: true, version, plugin_root: root,
  ...(launcher
    ? { startup: [{ command: ['sh', 'bin/run.sh', 'hook'] }], actions: [{ id: 'open', command: ['sh', 'bin/run.sh', 'open'] }] }
    : { startup: [{ command: ['target/release/herdr-projects', 'startup'] }] }),
})
const callLog = () => (fs.existsSync(calls) ? fs.readFileSync(calls, 'utf8').trim().split('\n') : [])

// The board links demo/1 to an agent pane of the scenario (its task.json, read only).
const home = path.join(path.dirname(fs.readFileSync(SOCK_FILE, 'utf8').trim()), 'home')
const taskDir = path.join(home, '.herdr-projects/data/tasks/demo/1')

test.beforeEach(() => { fs.rmSync(calls, { force: true }) })
test.afterEach(async () => { await fakeHerdr('e2e.plugins', { plugins: [] }) })
test.afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true })
  fs.rmSync(path.join(home, '.herdr-projects'), { recursive: true, force: true })
})

test('the Board shows the 1.x tasks in its five groups, and acts on them', async ({ page }, testInfo) => {
  fs.mkdirSync(taskDir, { recursive: true })
  fs.writeFileSync(path.join(taskDir, 'task.json'), JSON.stringify({ id: 'demo/1', link: { pane: CLAUDE_PANE } }))
  await fakeHerdr('e2e.plugins', { plugins: [manifest('1.2.1')] })
  await page.goto('/#/board')
  const phone = testInfo.project.name.includes('phone')
  const card = (key: string) => page.locator('.task-card', { hasText: key })
  if (phone) await page.getByRole('button', { name: /Ready to approve/ }).click()
  await expect(card('DEMO-1')).toContainText('Fix login redirect', { timeout: 15000 })
  await expect(card('DEMO-1')).toContainText('#7')
  await expect(card('DEMO-1')).toContainText('review · 1 minor')
  await page.screenshot({ path: `.shots/board-1x-${testInfo.project.name}.png` })
  if (phone) {
    await page.getByRole('button', { name: /Needs you/ }).click()
    await expect(card('DEMO-2')).toContainText('Which changelog format?')
  } else {
    for (const [col, key] of [['needs', 'DEMO-2'], ['ready', 'DEMO-1'], ['working', 'DEMO-3'], ['done', 'DEMO-4']] as const) {
      await expect(page.locator(`.board-col.${col} .task-card`, { hasText: key })).toBeVisible()
    }
  }
  expect(callLog()).toContain('list --json')

  // A task: its pull request, its review, approve (asked first).
  if (phone) await page.getByRole('button', { name: /Ready to approve/ }).click()
  await card('DEMO-1').click()
  const sheet = page.getByRole('dialog')
  await expect(sheet.locator('.task-sheet-facts')).toContainText('Pass · 1 minor · codex')
  await expect(sheet.getByRole('link', { name: /#7/ })).toHaveAttribute('href', 'https://github.com/example/demo/pull/7')
  await expect(sheet.locator('.task-sheet-text')).toHaveText('The login page loops')
  await expect(sheet.getByRole('button', { name: 'Open its agent' })).toBeVisible()
  await page.screenshot({ path: `.shots/board-1x-task-${testInfo.project.name}.png` })
  await sheet.getByRole('button', { name: 'Approve', exact: true }).click()
  await page.getByRole('dialog').last().getByRole('button', { name: 'Approve and merge' }).click()
  await expect.poll(callLog).toContain('approve -- demo/1')

  // A reply to a task's agent, and a message to the Coordinator: the user's words after "--".
  // DEMO-2 has had no agent yet: nothing to reply to. DEMO-3 has one.
  if (phone) await page.getByRole('button', { name: /Needs you/ }).click()
  await card('DEMO-2').click()
  await expect(page.getByRole('dialog').locator('.task-sheet-msg')).toHaveText('Which changelog format?')
  await expect(page.getByRole('dialog').getByRole('textbox')).toHaveCount(0)
  await page.keyboard.press('Escape')
  if (phone) await page.getByRole('button', { name: /Working/ }).click()
  await card('DEMO-3').click()
  await page.getByRole('dialog').getByRole('textbox').fill('--keep-a-changelog please')
  await page.getByRole('dialog').getByRole('button', { name: 'Send' }).click()
  await expect.poll(callLog).toContain('tell -- demo/3 --keep-a-changelog please')
  await page.keyboard.press('Escape')
  await page.locator('#board-coord-text').fill('Add a dark mode toggle')
  await page.locator('.board-coord').getByRole('button', { name: 'Send' }).click()
  await expect.poll(callLog).toContain('coordinator -- tell Add a dark mode toggle')
})

test('a 0.2 or a 1.x older than 1.2.1: the Board and Settings say what to do, and run nothing', async ({ page }, testInfo) => {
  for (const plugin of [manifest('0.2.34', false), manifest('1.2.0')]) {
    await fakeHerdr('e2e.plugins', { plugins: [plugin] })
    await page.goto('/#/settings?section=plugins')
    await page.reload()
    const machine = page.locator('.projects-plugin-machine').first()
    await expect(machine.locator('.projects-plugin-head')).toContainText(`Update needed · v${plugin.version}`, { timeout: 15000 })
    const note = machine.locator('.projects-upgrade')
    await expect(note).toContainText('Update herdr-projects to 1.2.1 or later, or downgrade wherdr to 1.3.4')
    await expect(note).toContainText('herdr plugin uninstall herdr-projects && herdr plugin install eliasstravik/herdr-projects --ref v1.2.1 --yes')
    await expect(note).toContainText('npm install -g wherdr@1.3.4')
    await expect(note).toContainText('docs/herdr-projects-1x.md')
    if (plugin.version === '0.2.34') {
      await note.scrollIntoViewIfNeeded()
      await page.screenshot({ path: `.shots/projects-plugin-old-${testInfo.project.name}.png` })
    }
  }
  await page.goto('/#/board')
  await expect(page.locator('.projects-upgrade')).toContainText('downgrade wherdr to 1.3.4', { timeout: 15000 })
  await expect(page.locator('.task-card')).toHaveCount(0)
  await page.screenshot({ path: `.shots/board-1x-old-${testInfo.project.name}.png` })
  // The rest of wherdr still works: the agent list.
  await page.goto('/')
  await expect(page.locator('.card').first()).toBeVisible()
  expect(callLog()).toEqual([])
})

test('without herdr-projects: install it, from 1.2.1', async ({ page }, testInfo) => {
  await page.route('**/api/plugins/projects?*', route => route.fulfill({ json: { status: 'missing', version: null, installable: true } }))
  await page.goto('/#/settings?section=plugins')
  const machine = page.locator('.projects-plugin-machine').first()
  await expect(machine.locator('.projects-plugin-head')).toContainText('Not installed', { timeout: 15000 })
  await expect(machine.locator('.projects-upgrade')).toContainText('herdr plugin install eliasstravik/herdr-projects --ref v1.2.1 --yes')
  await machine.getByRole('button', { name: 'Install herdr-projects', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('Install herdr-projects 1.2.1')
  await page.screenshot({ path: `.shots/projects-plugin-install-${testInfo.project.name}.png` })
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
})

// Replies of the server the Board must show as they are: a failed read, a container.
const row = (id: string, o: Record<string, unknown> = {}) => ({
  id, repo: id.split('/')[0], n: Number(id.split('/')[1]), state: 'blocked', kind: 'permission', stage: 'approval', title: `Task ${id}`, msg: '',
  app: 'claude', progress: null, eta: null, pr: '', review: null, reviewRound: 0, research: false, archived: false, queue: null, group: 'ready', ...o,
})
const reply = (machine: Record<string, unknown>) => ({ json: { version: `v-${Date.now()}`, machines: [{ machine: '', status: 'ready', version: '1.2.1', ...machine }] } })

test('a failed read says why, and keeps the last tasks marked with when they were read', async ({ page }, testInfo) => {
  const at = Date.UTC(2026, 0, 2, 9, 41)
  await page.route('**/api/tasks?*', route => route.fulfill(reply({ tasks: [row('demo/1')], at, stale: true, error: 'herdr-projects did not answer within 30 s' })))
  await page.route('**/api/tasks', route => route.fulfill(reply({ tasks: [row('demo/1')], at, stale: true, error: 'herdr-projects did not answer within 30 s' })))
  await page.goto('/#/board')
  const note = page.locator('.board-note.error')
  await expect(note).toContainText('herdr-projects did not answer within 30 s', { timeout: 15000 })
  await expect(note).toContainText('tasks as read at')
  if (testInfo.project.name.includes('phone')) await page.getByRole('button', { name: /Ready to approve/ }).click()
  await expect(page.locator('.task-card.stale')).toContainText('Task demo/1')
  await page.screenshot({ path: `.shots/board-1x-error-${testInfo.project.name}.png` })
})

test('Herdr not answering for a machine: said, not five empty columns', async ({ page }) => {
  await page.route('**/api/tasks*', route => route.fulfill(reply({ status: 'error', tasks: [], error: 'Herdr did not answer' })))
  await page.goto('/#/board')
  await expect(page.locator('.board-note.error')).toContainText('Herdr did not answer', { timeout: 15000 })
  await expect(page.locator('.board-col')).toHaveCount(0)
})

test('in a container: the tasks show, the actions are the host\'s', async ({ page }, testInfo) => {
  await page.route('**/api/tasks*', route => route.fulfill(reply({ tasks: [row('demo/1'), row('demo/3', { state: 'working', stage: 'working', kind: '', group: 'working', app: 'codex' })], at: Date.now(), readOnly: true })))
  await page.route('**/api/tasks/details*', route => route.fulfill({ json: { id: 'demo/1', title: 'Task demo/1', stage: 'approval', msg: '', description: 'From the file', agent: 'claude', pr: '', branch: '', worktree: '', failure: '', review: null, reviewRounds: 0, plan: '', research: false, pane: null } }))
  await page.goto('/#/board')
  await expect(page.locator('.board-notes')).toContainText('wherdr runs in a container', { timeout: 15000 })
  await expect(page.locator('.board-coord')).toHaveCount(0)
  if (testInfo.project.name.includes('phone')) await page.getByRole('button', { name: /Ready to approve/ }).click()
  await page.locator('.task-card', { hasText: 'Task demo/1' }).click()
  const sheet = page.getByRole('dialog')
  await expect(sheet).toContainText('herdr-projects approve demo/1')
  await expect(sheet.getByRole('button', { name: 'Approve', exact: true })).toHaveCount(0)
  await expect(sheet.getByRole('textbox')).toHaveCount(0)
  await page.screenshot({ path: `.shots/board-1x-container-${testInfo.project.name}.png` })
})
