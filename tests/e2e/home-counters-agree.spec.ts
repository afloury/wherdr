import { expect, test } from './test'
import fs from 'node:fs/promises'

// The home counters and the rows under them say the same thing, Board on:
// a task ready to approve is the user's turn (its badge and accent too), a
// coordinator counts by its state like any agent row, and a row standing for
// several terminals counts once. Invented data only.
test('home counters agree with the rows: tasks, coordinators, multi-terminal rows', async ({ page }, info) => {
  await expect.poll(async () => (await (await page.request.get('/api/state')).json()).ok).toBe(true)
  const base = await (await page.request.get('/api/state')).json()
  const template = base.panes.find((p: { id: string }) => p.id === 'w1:p1')
  const ws = (id: string, label: string, repo?: string) => ({ id, label, number: 0, status: null, worktree: false, ...(repo ? { repo, repoName: repo } : {}) })
  const pane = (id: string, status: string, name: string, agent: string | null = 'claude') => ({
    ...template, id, workspace: id.split(':')[0], tab: `${id.split(':')[0]}:t1`, tabLabel: null, agent, status, name, label: null, title: null,
    prompt: undefined, screen: undefined, menu: undefined, queued: undefined, pendingPrompt: false, usageLimit: undefined,
  })
  const workspaces = [
    ws('w10', 'Coordinator'), ws('w11', 'demo', 'demo'),
    ws('w21', 'DEMO-21', 'demo'), ws('w22', 'DEMO-22', 'demo'), ws('w23', 'DEMO-23', 'demo'),
    ws('w30', 'Docs refresh'), ws('w31', 'Lint pass'), ws('w32', 'Release notes'),
  ].map((w, i) => ({ ...w, number: i + 1 }))
  const panes = [
    pane('w10:p1', 'idle', 'Coordinator'),
    pane('w11:p1', 'working', 'demo coordinator'),
    pane('w21:p1', 'working', 'Worker'),
    pane('w22:p1', 'idle', 'Worker'),
    pane('w23:p1', 'blocked', 'Worker'),
    pane('w30:p1', 'working', 'Docs refresh'),
    pane('w31:p1', 'idle', 'Lint pass'),
    // One row, two terminals: counted once, as its row.
    pane('w32:p1', 'working', 'Release notes'), pane('w32:p2', 'idle', 'Release notes', 'codex'),
  ]
  const tabs = workspaces.map(w => ({ id: `${w.id}:t1`, workspace: w.id, label: '1', number: 1, layout: null }))
  const state = { ...base, workspaces, tabs, panes }
  await page.routeWebSocket('**/ws/events', s => s.send(JSON.stringify(state)))
  const task = (n: number, stage: string, group: string, title: string, msg: string) => ({
    id: `demo/${n}`, repo: 'demo', n, key: `DEMO-${n}`, title, panes: [{ id: `w${n}:p1`, role: 'worker' }], workspace: `w${n}`, stage, group, progress: null, msg, since: null,
  })
  await page.route('**/api/tasks/links**', route => route.fulfill({ json: {
    version: 'counters-fixture', machines: [{ machine: '', coordinators: [
      { level: 'top', pane: 'w10:p1', workspace: 'w10' },
      { level: 'project', repo: 'demo', pane: 'w11:p1', workspace: 'w11' },
    ], tasks: [
      task(21, 'working', 'working', 'Sample search filters', 'Writing tests'),
      task(22, 'approval', 'ready', 'Sample settings page', 'Ready to approve'),
      task(23, 'stopped', 'needs', 'Sample import screen', 'Which format?'),
    ] }],
  } }))
  const rows = [
    { id: 'demo/21', state: 'working', stage: 'working', group: 'working', title: 'Sample search filters', msg: 'Writing tests' },
    { id: 'demo/22', state: 'blocked', kind: 'permission', stage: 'approval', group: 'ready', title: 'Sample settings page', msg: 'Ready to approve' },
    { id: 'demo/23', state: 'blocked', stage: 'stopped', group: 'needs', title: 'Sample import screen', msg: 'Which format?' },
  ]
  await page.route(url => url.pathname === '/api/tasks', route => route.fulfill({ json: { version: 'cli', machines: [{ machine: '', status: 'ready', version: '1.2.21',
    tasks: rows.map(r => ({ kind: '', ...r, repo: 'demo', n: Number(r.id.split('/')[1]), app: 'claude', progress: null, eta: null, pr: '', review: null, reviewRound: 0, research: false, archived: false, queue: null, repoKey: 'DEMO' })) }] } }))
  await page.addInitScript(() => localStorage.setItem('herdrLanguage', 'en'))

  await page.goto('/')
  const approve = page.locator('.card', { hasText: 'DEMO-22' })
  await expect(approve.locator('.task-state')).toHaveText('Ready to approve')
  const shots = process.env.SHOTS || '.shots'
  await fs.mkdir(shots, { recursive: true })
  const tag = process.env.SHOT_TAG || 'after'
  // Tall enough for the whole list: phone 390 px wide, desktop 1440 px.
  await page.setViewportSize({ width: info.project.name.includes('phone') ? 390 : 1440, height: 1150 })
  await expect(page.locator('.card', { hasText: 'Lint pass' })).toBeInViewport()
  await page.screenshot({ path: `${shots}/home-counters-${tag}-${info.project.name}.png` })
  if (tag !== 'after') return

  const counters = async () => Object.fromEntries(await Promise.all(['blocked', 'working', 'done'].map(async s => [s, Number(await page.locator(`.stats .stat.${s} b`).textContent())])))
  // Your turn: DEMO-22 (to approve), DEMO-23 (needs you). Working: DEMO-21, the
  // project coordinator, Docs refresh, Release notes (one row, two terminals).
  // Ready: the top coordinator, Lint pass.
  expect(await counters()).toEqual({ blocked: 2, working: 4, done: 2 })
  // The badge and accent of a task to approve read as the user's turn.
  const turn = await page.locator('.stats .stat.blocked span i').evaluate(el => getComputedStyle(el).backgroundColor)
  await expect(approve.locator('.task-state')).toHaveCSS('color', turn)
  await expect(approve).toHaveClass(/\bblocked\b/)
  // Each counter's number in its own state colour.
  await expect(page.locator('.stats .stat.blocked b')).toHaveCSS('color', turn)
  const working = await page.locator('.stats .stat.working span i').evaluate(el => getComputedStyle(el).backgroundColor)
  await expect(page.locator('.stats .stat.working b')).toHaveCSS('color', working)
})
