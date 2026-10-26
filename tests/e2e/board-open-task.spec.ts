import fs from 'node:fs/promises'
import { expect, test, type Page, type Route } from './test'

// Opening a task from the sidebar: the Board and the task's panel at once (its
// shapes while its details load), the task selected in the sidebar and on the
// Board, and both on the machine that has it.
const shot = (page: Page, name: string, project: string) => page.screenshot({ path: `.shots/board-open-task-${name}-${project}.png` })

const row = (id: string, group: string) => ({
  id, repo: id.split('/')[0], n: Number(id.split('/')[1]), state: group === 'working' ? 'working' : 'idle', kind: '', stage: group, title: `Task ${id}`, msg: '',
  app: 'claude', progress: null, eta: null, pr: '', review: null, reviewRound: 0, research: false, archived: false, queue: null, group,
})
const tasks: Record<string, ReturnType<typeof row>[]> = { '': [row('demo/9', 'working'), row('demo/2', 'todo')], 'laptop': [row('side/4', 'todo')] }
const boardOf = (machines: string[]) => ({ version: 'v-open', machines: machines.map(machine => ({ machine, status: 'ready', version: '1.2.1', at: Date.now(), tasks: tasks[machine] })) })
const links = { version: 'open-fixture', machines: [{ machine: '', repos: [{ repo: 'demo', root: '/project', branch: 'main', behind: 0 }], coordinators: [],
  tasks: [{ id: 'demo/9', repo: 'demo', n: 9, key: 'DEMO-9', title: 'Task demo/9', panes: [{ id: 'w1:p1', role: 'worker' }], workspace: 'w1', stage: 'working', group: 'working', progress: 30, msg: '', since: Date.now() - 60000 }] }] }
const details = (id: string) => ({ id, title: `Task ${id}`, stage: 'working', pane: null, agent: 'claude' })

async function routes(page: Page, machines: string[], detailsMs: number) {
  await page.route('**/api/tasks/links**', route => route.fulfill({ json: links }))
  await page.route('**/api/tasks/details**', (route: Route) => {
    const id = new URL(route.request().url()).searchParams.get('id') || ''
    setTimeout(() => route.fulfill({ json: details(id) }).catch(() => {}), detailsMs)
  })
  await page.route(/\/api\/tasks(\?.*)?$/, route => route.fulfill({ json: boardOf(machines) }))
}

test('a task opens at once from the sidebar, with its shapes, and is selected in both places', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await routes(page, [''], 2000)
  await page.goto('/')
  const side = page.locator('.project-tree .card', { hasText: 'DEMO-9' })
  await expect(side).toBeVisible()
  await side.click()
  // The panel is there before its details answer: shapes, never "Loading…".
  const panel = page.locator('.board-panel[data-kind="task"]')
  await expect(panel).toBeVisible()
  await expect(panel.locator('.board-panel-skel .chat-skel')).toBeVisible()
  await expect(panel.locator('.skel-tabs')).toBeVisible()
  await expect(panel.getByText('Loading…')).toHaveCount(0)
  await fs.mkdir('.shots', { recursive: true })
  await shot(page, 'skeleton', testInfo.project.name)
  // Then its content.
  await expect(panel.locator('.board-panel-tabs button').first()).toBeVisible()
  await expect(panel.locator('.chat-skel')).toHaveCount(0)
  await expect(panel.locator('.board-panel-title')).toHaveText('Task demo/9')
  // Selected in the sidebar and on the Board.
  await expect(page.locator('.task-card.sel')).toHaveAttribute('data-task', 'demo/9')
  await expect(page.locator('.project-tree .card.sel', { hasText: 'DEMO-9' })).toBeVisible()
  await shot(page, 'selected-desktop', testInfo.project.name)
  // Another card: the selection follows it.
  // (The docked panel narrows the Board to one group at a time: its tab first.)
  await page.locator('.board-seg-btn.todo').click()
  await page.locator('.task-card[data-task="demo/2"] .task-card-open').click()
  await expect(page.locator('.task-card.sel')).toHaveAttribute('data-task', 'demo/2')
  await expect(page.locator('.project-tree .card.sel', { hasText: 'DEMO-9' })).toHaveCount(0)
  // Phone: the panel covers the Board; back on it, the card is still marked, in its column.
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: 'Back to the Board' }).click()
  await expect(panel).toHaveCount(0)
  await expect(page.locator('.task-card.sel')).toBeVisible()
  await expect(page.locator('.task-card.sel')).toHaveAttribute('data-task', 'demo/2')
  await expect(page.locator('.board-seg-btn.todo')).toHaveAttribute('aria-pressed', 'true')
  await shot(page, 'selected-phone', testInfo.project.name)
})

test('a quick read of its details shows no skeleton', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.addInitScript(() => {
    (window as unknown as { skel: boolean }).skel = false
    new MutationObserver(() => { if (document.querySelector('.board-panel .chat-skel, .skel-tabs')) (window as unknown as { skel: boolean }).skel = true })
      .observe(document.documentElement, { subtree: true, childList: true })
  })
  await routes(page, [''], 50)
  await page.goto('/')
  await page.locator('.project-tree .card', { hasText: 'DEMO-9' }).click()
  await expect(page.locator('.board-panel .board-panel-tabs button').first()).toBeVisible()
  await page.waitForTimeout(500)
  expect(await page.evaluate(() => (window as unknown as { skel: boolean }).skel)).toBe(false)
})

test('opening a task outside the shown machine moves the sidebar and the Board to it', async ({ page }) => {
  await expect.poll(async () => (await (await page.request.get('/api/state')).json()).ok).toBe(true)
  const base = await (await page.request.get('/api/state')).json()
  const keys = ['', 'laptop']
  const state = { ...base, machines: keys.map((key, i) => ({ key, label: ['Server', 'Laptop'][i], local: !key, status: 'online', error: null, session: 'default' })) }
  await page.routeWebSocket('**/ws/events', ws => ws.send(JSON.stringify(state)))
  await page.setViewportSize({ width: 1440, height: 900 })
  await routes(page, keys, 50)
  await page.goto('/')
  await page.locator('[data-bar-id="laptop"]').click()
  await page.goto('/#/board')
  const select = page.getByRole('combobox', { name: 'Machines shown' })
  await expect(select).toContainText('Laptop')
  await expect(page.locator('.task-card[data-task="demo/9"]')).toHaveCount(0)
  // A task of the other machine (a push, a link): both move to its machine.
  await page.evaluate(() => { location.hash = '#/board?machine=&task=demo%2F9' })
  await expect(page.locator('.board-panel[data-kind="task"]')).toBeVisible()
  await expect(page.locator('[data-bar-id=""]')).toHaveAttribute('aria-pressed', 'true')
  await expect(select).not.toContainText('Laptop')
  await expect(page.locator('.task-card.sel')).toHaveAttribute('data-task', 'demo/9')
  await expect(page.locator('.project-tree .card.sel', { hasText: 'DEMO-9' })).toBeVisible()
  // A scope that already shows the task's machine stays as it is.
  await page.locator('[data-bar-id="*"]').click()
  await expect(select).toContainText('All machines')
  await page.locator('.board-seg-btn.todo').click()
  await page.locator('.task-card[data-task="side/4"] .task-card-open').click()
  await expect(page.locator('.task-card.sel')).toHaveAttribute('data-task', 'side/4')
  await expect(select).toContainText('All machines')
  await expect(page.locator('[data-bar-id="*"]')).toHaveAttribute('aria-pressed', 'true')
})
