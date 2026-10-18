import { expect, test } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { CLAUDE_PANE, SOCK_FILE, fakeHerdr } from './scenario.mjs'

// herdr-projects 1.x on the Board and in Settings. The plugin's launcher
// (bin/run.sh) is a fake that answers with the real output of the 1.2.1
// release (tests/recordings/herdr-projects-1.2.1) and writes down each call.
// demo/6 failed in its agent's own work: 1.2.1 `retry` sends it back (failure_of's shape).
const failedDetails = { task: { id: 'demo/6', title: 'Broke on the tests', stage: 'failed', msg: 'Tests failed' }, failure: { stage: 'agent', title: 'Tests failed', detail: 'npm test exited 1', auth: false, agentCanFix: true } }
// `show --repo <name> --json`: a repo's key (1.2.1 settings show). web's is not its name.
const keyReply = (key: string) => JSON.stringify({ settings: [{ name: 'repo.key', kind: 'repo', value: key, from: 'your entry', place: 'you', own: false, note: '' }], problems: [] })
const fixtures = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../recordings/herdr-projects-1.2.1')
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wherdr-hp1x-'))
const calls = path.join(root, 'calls.log')
fs.mkdirSync(path.join(root, 'bin'))
fs.writeFileSync(path.join(root, 'bin/run.sh'), `#!/bin/sh
printf '%s\\n' "$*" >> '${calls}'
case "$1" in
  list) if [ -f '${root}/list.json' ]; then cat '${root}/list.json'; else cat '${fixtures}/list.json'; fi ;;
  details) case "$4" in demo/1) cat '${fixtures}/details-approval.json' ;; demo/2) cat '${fixtures}/details-asks.json' ;; demo/6) echo '${JSON.stringify(failedDetails)}' ;; *) cat '${fixtures}/details-working.json' ;; esac ;;
  tell) echo "$3: sent" ;;
  approve) echo "$3: approved, merging" ;;
  coordinator) echo "sent to the Coordinator" ;;
  add) echo "demo/7: added" ;;
  delegate|stop|retry|archive) echo "$3: done" ;;
  show) case "$2" in --repo=demo) echo '${keyReply('DEMO')}' ;; --repo=web) echo '${keyReply('SITE')}' ;; *) echo '${keyReply('none')}' ;; esac ;;
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

test.beforeEach(() => { fs.rmSync(calls, { force: true }); fs.rmSync(path.join(root, 'list.json'), { force: true }) })
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
  // Grouped by repo by default; the five groups are one tap away.
  await expect(page.locator('.board-repo[data-repo="demo"]')).toBeVisible({ timeout: 15000 })
  await page.getByRole('button', { name: 'By status' }).click()
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
  await page.locator('.board-coord').getByRole('button', { name: 'Send', exact: true }).click()
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
  await expect(page.locator('.board-head-add')).toHaveCount(0)
  await expect(page.locator('.board-new')).toHaveCount(0)
  await page.locator('.task-card', { hasText: 'Task demo/1' }).click()
  const sheet = page.getByRole('dialog')
  await expect(sheet).toContainText('herdr-projects approve demo/1')
  await expect(sheet.getByRole('button', { name: 'Approve', exact: true })).toHaveCount(0)
  await expect(sheet.getByRole('textbox')).toHaveCount(0)
  await page.screenshot({ path: `.shots/board-1x-container-${testInfo.project.name}.png` })
})

// A board with a task for each action, in two repos.
const actionBoard = [
  { id: 'demo/5', state: 'idle', title: 'In the backlog', stage: 'todo' },
  { id: 'demo/6', state: 'error', app: 'claude', title: 'Broke on the tests', msg: 'npm test failed', stage: 'failed' },
  { id: 'demo/3', state: 'working', app: 'codex', title: 'Add dark mode toggle', msg: 'Writing tests', stage: 'working', progress: 40 },
  { id: 'web/2', state: 'done', title: 'Old cleanup', msg: 'Merged', stage: 'done' },
]

test('grouped by machine then repo: each heading talks to its coordinator, Send and Send and start', async ({ page }, testInfo) => {
  fs.writeFileSync(path.join(root, 'list.json'), JSON.stringify(actionBoard))
  await fakeHerdr('e2e.plugins', { plugins: [manifest('1.2.1')] })
  await page.goto('/#/board')
  const demo = page.locator('.board-repo[data-repo="demo"]')
  const web = page.locator('.board-repo[data-repo="web"]')
  await expect(demo).toContainText('In the backlog', { timeout: 15000 })
  await expect(demo.locator('.board-head')).toContainText('1 needs you · 1 working · 1 to do')
  await expect(web).toContainText('Old cleanup')
  // Each task by its repo's key (show --repo), not its repo's name: web's is SITE.
  await expect(web.locator('.task-card')).toContainText('SITE-2')
  await expect(demo.locator('.task-card', { hasText: 'In the backlog' })).toContainText('DEMO-5')
  await expect(page.locator('.board-head.machine')).toBeVisible()
  // Under each repo, the board's five groups: each card in its own.
  const col = (repo: typeof demo, g: string) => repo.locator(`.board-repo-col[data-group="${g}"]`)
  await expect(col(demo, 'needs')).toContainText('Broke on the tests')
  await expect(col(demo, 'working')).toContainText('Add dark mode toggle')
  await expect(col(demo, 'todo')).toContainText('In the backlog')
  await expect(col(web, 'done')).toContainText('Old cleanup')
  if (testInfo.project.name.includes('phone')) {
    // Phone: stacked sections that fold; an empty group is left out.
    await expect(col(demo, 'ready')).toBeHidden()
    await col(demo, 'todo').locator('.board-repo-col-head').click()
    await expect(col(demo, 'todo')).not.toContainText('In the backlog')
    await col(demo, 'todo').locator('.board-repo-col-head').click()
    await expect(col(demo, 'todo')).toContainText('In the backlog')
  } else {
    // Computer: five columns side by side; an empty one stays, narrow.
    await expect(col(demo, 'ready')).toBeVisible()
    await expect(col(demo, 'ready')).toHaveClass(/empty/)
    const empty = (await col(demo, 'ready').boundingBox())!.width
    expect(empty).toBeLessThan((await col(demo, 'needs').boundingBox())!.width)
  }
  await page.screenshot({ path: `.shots/board-1x-repos-${testInfo.project.name}.png` })

  const label = page.locator('.board-coord-label')
  const text = page.locator('#board-coord-text')
  // A repo's heading: its project coordinator. Send and start = --delegate.
  await page.getByRole('button', { name: 'Talk to the web coordinator' }).click()
  await expect(label).toContainText('web coordinator')
  await expect(web.locator('.board-head')).toHaveClass(/talking/)
  await text.fill('--tidy up')
  await page.screenshot({ path: `.shots/board-1x-project-coord-${testInfo.project.name}.png` })
  await page.getByRole('button', { name: 'Send and start' }).click()
  await expect.poll(callLog).toContain('coordinator --project=web --delegate -- tell --tidy up')
  // The machine's heading: its machine coordinator; Enter sends.
  await page.locator('.board-head.machine .board-head-talk').click()
  await expect(label).toContainText('coordinator')
  await text.fill('machine hello')
  await text.press('Enter')
  await expect.poll(callLog).toContain('coordinator --machine -- tell machine hello')
  // Back to the Coordinator.
  await page.locator('.board-coord-back').click()
  await expect(label).toHaveText('Coordinator')
  await text.fill('plain')
  await page.locator('.board-coord').getByRole('button', { name: 'Send', exact: true }).click()
  await expect.poll(callLog).toContain('coordinator -- tell plain')

  // A folded repo hides its tasks, and stays folded on this device.
  await web.locator('.board-fold').click()
  await expect(web).not.toContainText('Old cleanup')
  await page.reload()
  await expect(page.locator('.board-repo[data-repo="web"]')).not.toContainText('Old cleanup', { timeout: 15000 })
  await expect(page.locator('.board-repo[data-repo="demo"]')).toContainText('In the backlog')
})

test('+ New task: in a repo, with Start now; and the task sheet starts, stops, retries and archives', async ({ page }, testInfo) => {
  test.setTimeout(60000)
  fs.writeFileSync(path.join(root, 'list.json'), JSON.stringify(actionBoard))
  await fakeHerdr('e2e.plugins', { plugins: [manifest('1.2.1')] })
  await page.goto('/#/board')
  const demo = page.locator('.board-repo[data-repo="demo"]')
  await expect(demo).toContainText('In the backlog', { timeout: 15000 })

  await page.getByRole('button', { name: 'New task in demo' }).click()
  const sheet = page.getByRole('dialog')
  await expect(sheet.getByRole('button', { name: 'Add to To do' })).toBeVisible()
  await sheet.getByLabel('Title').fill('Fix the footer')
  await sheet.getByLabel('Description').fill('--steps here')
  await sheet.getByRole('switch').click()
  await page.screenshot({ path: `.shots/board-1x-new-task-${testInfo.project.name}.png` })
  await sheet.getByRole('button', { name: 'Add and start' }).click()
  await expect.poll(callLog).toContain('add --desc=--steps here --repo=demo --delegate -- Fix the footer')
  await expect(sheet).toHaveCount(0)
  // From the header: the home folder by default, no agent; a repo picked, then the home folder again.
  const selectErrors: string[] = []
  page.on('console', (m) => { if (m.type() === 'error' && /Select/i.test(m.text())) selectErrors.push(m.text()) })
  await page.locator('.board-new').click()
  await page.locator('#new-task-repo').click()
  await page.getByRole('option', { name: 'web' }).click()
  await expect(page.locator('#new-task-repo')).toContainText('web')
  await page.locator('#new-task-repo').click()
  await page.getByRole('option', { name: 'Home folder' }).click()
  await expect(page.locator('#new-task-repo')).toContainText('Home folder')
  expect(selectErrors).toEqual([])
  await page.getByRole('dialog').getByLabel('Title').fill('Home chores')
  await page.getByRole('dialog').getByRole('button', { name: 'Add to To do' }).click()
  await expect.poll(callLog).toContain('add -- Home chores')

  const card = (title: string) => page.locator('.task-card', { hasText: title })
  const task = page.getByRole('dialog')
  // To do: Start.
  await card('In the backlog').click()
  await expect(task.getByRole('button', { name: 'Stop' })).toHaveCount(0)
  await task.getByRole('button', { name: 'Start', exact: true }).click()
  await expect.poll(callLog).toContain('delegate -- demo/5')
  await page.keyboard.press('Escape')
  // Working: Stop, asked first; no Archive.
  await card('Add dark mode toggle').click()
  await expect(task.getByRole('button', { name: 'Archive' })).toHaveCount(0)
  await task.getByRole('button', { name: 'Stop', exact: true }).click()
  await page.getByRole('dialog').last().getByRole('button', { name: 'Stop the agent' }).click()
  await expect.poll(callLog).toContain('stop -- demo/3')
  await expect(page.getByRole('dialog')).toHaveCount(1)
  // The sheet stays open after a stop (to reply or retry): closed by its button.
  await task.locator('.hw-sheet-close').click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  // Failed: Retry, then Archive (the sheet closes).
  await card('Broke on the tests').click()
  await expect(task.getByRole('button', { name: 'Retry' })).toBeVisible()
  await page.screenshot({ path: `.shots/board-1x-task-actions-${testInfo.project.name}.png` })
  await task.getByRole('button', { name: 'Retry' }).click()
  await expect.poll(callLog).toContain('retry -- demo/6')
  await task.getByRole('button', { name: 'Archive' }).click()
  await expect.poll(callLog).toContain('archive -- demo/6')
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

test('a push about a task opens it on the Board', async ({ page }) => {
  fs.writeFileSync(path.join(root, 'list.json'), JSON.stringify(actionBoard))
  await fakeHerdr('e2e.plugins', { plugins: [manifest('1.2.1')] })
  await page.goto('/#/board?machine=&task=demo%2F6')
  const sheet = page.getByRole('dialog')
  await expect(sheet).toContainText('Broke on the tests', { timeout: 15000 })
  await expect(sheet.getByRole('button', { name: 'Retry' })).toBeVisible()
  // Settings give the one command that turns these pushes on.
  await page.goto('/#/settings?section=plugins')
  await expect(page.locator('.projects-plugin-notify')).toContainText(`herdr-projects set board.notify 'herdr notification show`, { timeout: 15000 })
})

// Two machines, answered by the page itself (/api/tasks): the same task id on
// both, a machine that stops answering, a board kept from an earlier visit.
type Fake = { machine: string, status?: string, error?: string, stale?: boolean, tasks: { id: string, title: string }[] }
const fakeRow = (id: string, title: string) => ({
  id, repo: id.split('/')[0], n: Number(id.split('/')[1]), state: 'blocked', kind: 'question', stage: 'asks', title, msg: '', app: 'claude',
  progress: null, eta: null, pr: '', review: null, reviewRound: 0, research: false, archived: false, queue: null, group: 'needs',
})
async function fakeBoard(page: import('@playwright/test').Page, get: () => Fake[], delay = 0) {
  let n = 0
  await page.route(url => new URL(url).pathname === '/api/tasks', async (route) => {
    if (delay) await new Promise(r => setTimeout(r, delay))
    await route.fulfill({ json: { version: `v${++n}`, machines: get().map(m => ({ status: 'ready', version: '1.2.1', at: Date.now(), ...m, tasks: m.tasks.map(t => fakeRow(t.id, t.title)) })) } })
  })
  await page.route(url => new URL(url).pathname === '/api/tasks/details', route => route.fulfill({
    json: { id: new URL(route.request().url()).searchParams.get('id'), title: '', stage: 'asks', msg: '', description: '', agent: 'claude', pr: '', branch: '', worktree: '', failure: '', failureStage: '', failureAuth: false, review: null, reviewRounds: 0, plan: '', research: false, pane: null },
  }))
}

test('a push opens its own machine\'s task, never the same id on another machine', async ({ page }) => {
  let machines: Fake[] = [{ machine: 'ma', tasks: [] }, { machine: 'mb', tasks: [{ id: 'demo/1', title: 'On machine B' }] }]
  await fakeBoard(page, () => machines)
  await page.goto('/#/board?machine=ma&task=demo%2F1')
  await expect(page.locator('.board-machine[data-machine="mb"]')).toContainText('On machine B', { timeout: 15000 })
  await expect(page.locator('.hw-toast-title', { hasText: 'That task is no longer on the Board' })).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  // Machine A does not answer: said, and its task opens once it does.
  machines = [{ machine: 'ma', status: 'error', error: 'No answer', tasks: [] }, machines[1]!]
  await page.evaluate(() => { location.hash = '#/' })
  await expect(page.locator('.board-view')).toHaveCount(0)
  await page.evaluate(() => { location.hash = '#/board?machine=ma&task=demo%2F1' })
  await expect(page.locator('.hw-toast-title', { hasText: /cannot be read now: its task opens once it answers/ })).toBeVisible({ timeout: 15000 })
  await expect(page.getByRole('dialog')).toHaveCount(0)
  machines = [{ machine: 'ma', tasks: [{ id: 'demo/1', title: 'On machine A' }] }, machines[1]!]
  await page.locator('.board-filter').click()
  await expect(page.getByRole('dialog')).toContainText('On machine A', { timeout: 15000 })
})

test('a push for a task newer than the board kept from the last visit opens it after the next read', async ({ page }) => {
  let machines: Fake[] = [{ machine: '', tasks: [{ id: 'demo/1', title: 'Older one' }] }]
  await fakeBoard(page, () => machines, 800)
  await page.goto('/#/board')
  await expect(page.locator('.task-card', { hasText: 'Older one' })).toBeVisible({ timeout: 15000 })
  // Elsewhere in the app; the task is added meanwhile; its push is tapped.
  await page.evaluate(() => { location.hash = '#/' })
  await expect(page.locator('.board-view')).toHaveCount(0)
  machines = [{ machine: '', tasks: [{ id: 'demo/9', title: 'Brand new' }, { id: 'demo/1', title: 'Older one' }] }]
  await page.evaluate(() => { location.hash = '#/board?machine=&task=demo%2F9' })
  await expect(page.getByRole('dialog')).toContainText('Brand new', { timeout: 15000 })
  await expect(page.locator('.hw-toast-title', { hasText: 'That task is no longer on the Board' })).toHaveCount(0)
})

test('a draft for a coordinator stays with it while its machine is away, and is sent there once it is back', async ({ page }) => {
  let machines: Fake[] = [{ machine: 'ma', tasks: [{ id: 'demo/1', title: 'On A' }] }, { machine: 'mb', tasks: [{ id: 'web/2', title: 'On B' }] }]
  await fakeBoard(page, () => machines)
  const sent: unknown[] = []
  await page.route(url => new URL(url).pathname === '/api/tasks/coordinator', async (route) => {
    sent.push(route.request().postDataJSON())
    await route.fulfill({ json: { ok: true, msg: 'sent' } })
  })
  await page.goto('/#/board')
  await page.locator('.board-machine[data-machine="ma"] .board-repo[data-repo="demo"] .board-head-talk').click({ timeout: 15000 })
  const text = page.locator('#board-coord-text')
  await text.fill('Draft for demo on A')
  const send = page.locator('.board-coord').getByRole('button', { name: 'Send', exact: true })
  // Machine A stops answering: the box keeps its target and its words, and sends nothing.
  machines = [{ machine: 'ma', status: 'error', error: 'No answer', tasks: [] }, machines[1]!]
  await page.locator('.board-filter').click()
  await expect(page.locator('.board-coord-away')).toBeVisible({ timeout: 15000 })
  await expect(page.locator('.board-coord-label')).toContainText('demo coordinator')
  await expect(text).toHaveValue('Draft for demo on A')
  await expect(send).toBeDisabled()
  await expect(page.locator('.board-coord-start')).toBeDisabled()
  // Back: still A's demo coordinator.
  machines = [{ machine: 'ma', tasks: [{ id: 'demo/1', title: 'On A' }] }, machines[1]!]
  await page.locator('.board-filter').click()
  await expect(page.locator('.board-coord-away')).toHaveCount(0, { timeout: 15000 })
  await send.click()
  await expect.poll(() => sent).toEqual([{ machine: 'ma', text: 'Draft for demo on A', to: { kind: 'project', repo: 'demo' }, delegate: false }])
})
