import { expect, test } from './test'
import fs from 'node:fs/promises'

for (const compact of [true, false]) {
  test(`projects without coordinators keep their identity (${compact ? 'compact' : 'normal'})`, async ({ page }) => {
    test.setTimeout(90_000)
    await expect.poll(async () => (await (await page.request.get('/api/state')).json()).ok).toBe(true)
    const base = await (await page.request.get('/api/state')).json()
    const state = { ...base, machines: [
      { key: '', label: 'Server', local: true, status: 'online', error: null },
      { key: 'buildbox', label: 'Buildbox', local: false, status: 'online', error: null },
    ] }
    for (const item of [...state.workspaces, ...(state.tabs || []), ...state.panes]) item.machine = (item.workspace || item.id) === 'w2' ? 'buildbox' : ''
    // The workspace folder deliberately differs from the board's repo name.
    for (const w of state.workspaces) if (w.id === 'w1') Object.assign(w, { repo: '/worktrees/feature/.git', repoName: 'feature', worktree: true })
    await page.routeWebSocket('**/ws/events', ws => ws.send(JSON.stringify(state)))
    await page.route('**/api/tasks/links**', route => route.fulfill({ json: {
      version: 'identity-fixture', machines: [{ machine: '',
        coordinators: [{ level: 'project', repo: 'tools', pane: 'w3:p1', workspace: null }],
        tasks: [{ id: 'shop/1', repo: 'shop', n: 1, key: 'SHOP-1', title: 'Check the layout',
          panes: [{ id: 'w1:p1', role: 'worker' }], workspace: 'w1', stage: 'working', progress: 30, msg: '', since: null }],
        repos: [{ repo: 'shop', root: '/shop', branch: 'main', behind: 0 }],
      }],
    } }))
    await page.addInitScript(compact => {
      localStorage.setItem('herdrLanguage', 'en')
      localStorage.setItem('compactListV2', compact ? '1' : '0')
      localStorage.setItem('machineBarPick', JSON.stringify('*'))
    }, compact)
    await page.goto('/')
    await fs.mkdir('.shots', { recursive: true })
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 })
      for (const all of [true, false]) {
        await page.locator('.machine-bar-item', { hasText: all ? 'All' : 'Server' }).first().click()
        await expect(page.locator('section.machine')).toHaveCount(all ? 2 : 1)
        const project = page.locator('.project[data-repo="shop"]')
        const header = project.locator('.project-identity')
        await expect(header.locator('h2')).toHaveText('shop')
        await expect(header.locator('.project-key')).toHaveText('SHOP')
        await expect(header.locator('.card, .card-state, .lead-coord-tag')).toHaveCount(0)
        await expect(project.locator('.project-tree')).toContainText('SHOP-1')
        await expect(header.locator('h2')).toHaveCSS('text-transform', 'uppercase')
        await expect(header).toHaveCSS('border-top-style', 'solid')
        await expect(header.locator('.space-menu')).toBeVisible()
        expect(await header.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
        await header.locator('h2').click()
        await expect(page).toHaveURL(/\/$/)
        await project.locator('.project-head').click()
        await expect(header).toBeVisible()
        await expect(project.locator('.project-tree')).toHaveCount(0)
        await project.locator('.project-head').click()
        await page.screenshot({ path: `.shots/project-identity-${compact ? 'compact' : 'normal'}-${width}-${all ? 'all' : 'single'}.png` })
      }
    }
    await expect(page.getByText('Start coordinator', { exact: true })).toHaveCount(0)
    await page.locator('.project[data-repo="shop"] .project-identity .space-menu').click()
    await expect(page.getByText('Start coordinator', { exact: true })).toBeVisible()
    await page.screenshot({ path: `.shots/project-identity-menu-${compact ? 'compact' : 'normal'}.png` })
  })
}
