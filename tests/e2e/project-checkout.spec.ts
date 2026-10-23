import { expect, test } from './test'
import fs from 'node:fs/promises'

test('moved checkout belongs to its board project and its menu cannot rename the project', async ({ page }) => {
  const base = await (await page.request.get('/api/state')).json()
  const keep = new Set(['w1', 'w6'])
  const state = { ...base,
    workspaces: base.workspaces.filter((w: { id: string }) => keep.has(w.id)).map((w: { id: string }) => ({ ...w, label: w.id === 'w6' ? 'new-folder' : 'Worker', repo: undefined, worktree: false })),
    tabs: base.tabs.filter((t: { workspace: string }) => keep.has(t.workspace)),
    panes: base.panes.filter((p: { workspace: string }) => keep.has(p.workspace)).map((p: { workspace: string }) => ({ ...p, cwd: p.workspace === 'w6' ? '/projects/new-folder' : '/projects/task', prompt: undefined, menu: undefined })),
  }
  await page.routeWebSocket('**/ws/events', ws => ws.send(JSON.stringify(state)))
  await page.route('**/api/tasks/links**', route => route.fulfill({ json: { version: 'checkout', machines: [{ machine: '', coordinators: [], repos: [{ repo: 'original-project', root: '/projects/new-folder', branch: 'main', behind: 0 }], tasks: [{ id: 'original-project/1', repo: 'original-project', n: 1, key: 'DEMO-1', title: 'Improve navigation', panes: [{ id: 'w1:p1', role: 'worker' }], workspace: 'w1', stage: 'working', progress: 40, msg: '', since: null }] }] } }))
  await page.goto('/')
  const project = page.locator('.project[data-repo="original-project"]')
  await expect(project.locator('.project-lead')).toHaveCount(0)
  await expect(page.locator('.card-title', { hasText: 'new-folder' })).toHaveCount(0)
  await project.getByRole('button', { name: 'Options: original-project', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Rename space', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Notifications', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Open the terminal of original-project', exact: true })).toBeVisible()
  await fs.mkdir('.shots', { recursive: true })
  for (const [width, height] of [[390, 844], [1440, 900]]) {
    await page.setViewportSize({ width, height })
    await page.screenshot({ path: `.shots/project-checkout-menu-${width}.png` })
  }
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  for (const [width, height] of [[390, 844], [1440, 900]]) {
    await page.setViewportSize({ width, height })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: `.shots/project-checkout-${width}.png` })
  }
  // Long-press the summary bar on touch devices to open the same menu.
  await project.locator('.project-head').dispatchEvent('pointerdown', { pointerType: 'touch', clientX: 20, clientY: 20 })
  await expect(page.getByRole('dialog')).toBeVisible()
  await project.locator('.project-head').dispatchEvent('pointerup', { pointerType: 'touch' })
  await expect(page.getByRole('button', { name: 'Rename space', exact: true })).toHaveCount(0)
  await page.keyboard.press('Escape')
  await page.reload()
  await expect(project.locator('.project-lead')).toHaveCount(0)
  await expect(page.locator('.card-title', { hasText: 'new-folder' })).toHaveCount(0)
})

test('an acknowledged rename without effect returns a clear error', async ({ page }) => {
  await page.goto('/')
  const response = await page.request.post('/api/space', {
    headers: { Origin: new URL(page.url()).origin },
    data: { op: 'workspace.rename', workspace_id: 'w6', label: 'Unapplied name' },
  })
  expect(response.ok()).toBe(false)
  expect(await response.json()).toMatchObject({ code: 'rename_failed', error: 'Rename failed. The name was not changed.' })
})
