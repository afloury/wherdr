import { expect, test } from './test'
import fs from 'node:fs/promises'

for (const kind of ['local', 'remote', 'terminal'] as const) {
  test(`project head: ${kind} coordinator`, async ({ page }) => {
    const base = await (await page.request.get('/api/state')).json()
    const keep = new Set(['w1', 'w6', 'w7'])
    const remote = 'abcd1234'
    const id = (value: string) => kind === 'remote' && value.startsWith('w7') ? `${remote}~${value}` : value
    const state = { ...base,
      machines: [{ key: '', label: 'Server', local: true, status: 'online', error: null },
        ...(kind === 'remote' ? [{ key: remote, label: 'Build box', local: false, status: 'online', error: null }] : [])],
      workspaces: base.workspaces.filter((w: { id: string }) => keep.has(w.id)).map((w: { id: string }) => ({ ...w, id: id(w.id), machine: kind === 'remote' && w.id === 'w7' ? remote : '', repo: undefined, worktree: w.id === 'w1' })),
      tabs: base.tabs.filter((t: { workspace: string }) => keep.has(t.workspace)).map((t: { id: string, workspace: string }) => ({ ...t, id: id(t.id), workspace: id(t.workspace) })),
      panes: base.panes.filter((p: { workspace: string }) => keep.has(p.workspace)).map((p: { id: string, workspace: string, tab: string }) => ({ ...p, id: id(p.id), workspace: id(p.workspace), tab: id(p.tab), machine: kind === 'remote' && p.workspace === 'w7' ? remote : '', ...(p.workspace === 'w6' ? { agent: null, status: null } : {}), cwd: p.workspace === 'w6' ? '/projects/demo' : '/projects/worker', prompt: undefined, menu: undefined })),
    }
    await page.routeWebSocket('**/ws/events', ws => ws.send(JSON.stringify(state)))
    const coordinator = { level: 'project', repo: 'demo', pane: id('w7:p1'), workspace: null }
    await page.route('**/api/tasks/links**', route => route.fulfill({ json: { version: `head-${kind}`, machines: [
      { machine: '', repos: [{ repo: 'demo', root: '/projects/demo', branch: 'main', behind: 0 }],
        coordinators: kind === 'local' ? [coordinator] : [],
        tasks: [{ id: 'demo/1', repo: 'demo', n: 1, key: 'DEMO-1', title: 'Improve navigation', panes: [{ id: 'w1:p1', role: 'worker' }], workspace: 'w1', stage: 'working', progress: 40, msg: '', since: null }] },
      ...(kind === 'remote' ? [{ machine: remote, tasks: [], coordinators: [coordinator] }] : []),
    ] } }))
    await page.goto('/')
    const project = page.locator('section.project[data-repo="demo"]').first()
    await expect(project.locator('.project-tree .card')).toHaveCount(1)
    await expect(project.locator('.project-lead')).toHaveCount(kind === 'local' ? 1 : 0)
    await expect(project.locator('.project-remote')).toHaveCount(kind === 'remote' ? 1 : 0)
    const headClass = kind === 'local' ? 'project-lead' : 'project-identity'
    await expect(project.locator(':scope > :first-child')).toHaveClass(new RegExp(headClass))
    if (kind !== 'local') {
      const identity = project.locator('.project-identity')
      await expect(identity.locator('h2')).toHaveText('demo')
      await expect(identity.locator('.project-key')).toHaveText('DEMO')
      await expect(identity.locator('.card, .card-state, .lead-coord-tag')).toHaveCount(0)
      await expect(identity.locator('.project-name')).toHaveCSS('text-transform', 'uppercase')
      await expect(identity.locator('.space-menu')).toBeVisible()
    }
    if (kind === 'local') await expect(project.locator('.lead-coord-tag')).toHaveText('Coordinator')
    if (kind === 'remote') await expect(project.locator('.project-remote')).toContainText('Coordinated from Build box')
    await fs.mkdir('.shots', { recursive: true })
    for (const [width, height] of [[390, 844], [1440, 900]]) {
      await page.setViewportSize({ width, height })
      await expect(project).toBeVisible()
      expect(await project.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
      // Check the actual header and menu bounds too: a clipped ancestor must
      // not hide an overflowing phone header or an unreachable options button.
      const head = project.locator(`.${headClass}`)
      expect(await head.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
      const bounds = (await project.boundingBox())!
      for (const item of [head, project.getByRole('button', { name: 'Options: demo', exact: true })]) {
        const box = (await item.boundingBox())!
        expect(box.x).toBeGreaterThanOrEqual(bounds.x)
        expect(box.x + box.width).toBeLessThanOrEqual(bounds.x + bounds.width)
        expect(box.x + box.width).toBeLessThanOrEqual(width)
      }
      await page.screenshot({ path: `.shots/project-head-${kind}-${width}.png` })
    }
    await project.locator('.project-head').click()
    await expect(project.locator('.project-tree')).toHaveCount(0)
    await expect(project.locator(':scope > :first-child')).toHaveClass(new RegExp(headClass))
    if (kind === 'terminal') {
      await project.getByRole('button', { name: 'Options: demo', exact: true }).click()
      await page.getByRole('button', { name: 'Open the terminal of demo', exact: true }).click()
      await expect(page.locator('.xterm-screen')).toBeVisible()
    }
    if (kind === 'remote') {
      // From a bar tab that does not show the coordinator's machine, the
      // link switches to that machine's tab, as opening it from the list does.
      for (const [width, height] of [[1440, 900], [390, 844]]) {
        await page.setViewportSize({ width, height })
        await page.goto('/#/')
        await page.locator('[data-bar-id=""]').click()
        await expect(page.locator('[data-bar-id=""]')).toHaveAttribute('aria-pressed', 'true')
        await project.locator('.project-remote').click()
        await expect.poll(() => decodeURIComponent(page.url())).toContain(`/a/${remote}~w7:p1`)
        if (width < 1000) await page.goBack()
        await expect(page.locator(`[data-bar-id="${remote}"]`)).toHaveAttribute('aria-pressed', 'true')
        await expect(page.locator('[data-bar-id=""]')).toHaveAttribute('aria-pressed', 'false')
      }
    }
  })
}
