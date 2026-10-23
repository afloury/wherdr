import { expect, test } from './test'
import { OMP_CHAT_PANE, OMP_IMAGE_PANE } from './scenario.mjs'

test('machine tabs restore the last conversation and preserve an unsent draft', async ({ page }) => {
  // Exercise the split view on the same browser as the phone journey below.
  await page.setViewportSize({ width: 1440, height: 900 })
  await expect.poll(async () => (await (await page.request.get('/api/state')).json()).ok).toBe(true)
  const base = await (await page.request.get('/api/state')).json()
  const first = base.panes.find((p: { id: string }) => p.id === OMP_CHAT_PANE).workspace
  const machineFor = (workspace: string) => workspace === first ? '' : 'remote'
  const state = { ...base,
    machines: [{ key: '', label: 'Server', local: true, status: 'online', error: null }, { key: 'remote', label: 'Remote', local: false, status: 'online', error: null }],
    workspaces: base.workspaces.map((w: { id: string }) => ({ ...w, machine: machineFor(w.id) })),
    panes: base.panes.map((p: { workspace: string }) => ({ ...p, machine: machineFor(p.workspace) })),
    tabs: base.tabs.map((t: { workspace: string }) => ({ ...t, machine: machineFor(t.workspace) })),
  }
  await page.routeWebSocket('**/ws/events', ws => ws.send(JSON.stringify(state)))
  const local = state.panes.find((p: { id: string }) => p.id === OMP_CHAT_PANE)
  const remote = state.panes.find((p: { id: string }) => p.id === OMP_IMAGE_PANE)
  expect(local).toBeTruthy()
  expect(remote).toBeTruthy()
  await page.goto(`/#/a/${encodeURIComponent(local.id)}`)
  await expect(page.locator('.machine-bar')).toBeVisible()
  await page.locator('[data-bar-id=""]').click()
  const input = page.locator('.prompt textarea')
  await input.fill('Unsent tab switching draft')
  await page.goto(`/#/a/${encodeURIComponent(remote.id)}`)
  await expect(page.locator('.machine-bar')).toBeVisible()
  await page.locator('[data-bar-id="remote"]').click()
  await page.locator('[data-bar-id=""]').click()
  await expect.poll(() => decodeURIComponent(page.url()).split('#')[1]).toBe(`/a/${local.id}`)
  await expect(page.locator('.prompt textarea')).toHaveValue('Unsent tab switching draft')
  await page.locator('[data-bar-id="*"]').click()
  await expect(page.locator('.prompt textarea')).toHaveValue('Unsent tab switching draft')
  await page.locator('[data-bar-id="remote"]').click()
  await expect.poll(() => decodeURIComponent(page.url()).split('#')[1]).toBe(`/a/${remote.id}`)
  // Device memory survives a reload; a phone still shows the list first.
  await page.reload()
  await expect(page.locator('.machine-bar')).toBeVisible()
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/#/')
  await page.locator('[data-bar-id=""]').click()
  await expect(page).toHaveURL(/#\/$/)
  await page.goBack()
  await expect.poll(() => decodeURIComponent(page.url()).split('#')[1]).toBe(`/a/${local.id}`)

  // A new choice from global search overrides the list filter, even after a
  // tab switch. It must not be mistaken for reopening the old history entry.
  for (const pick of ['*', 'remote']) {
    await page.goto('/#/')
    await page.locator(`[data-bar-id="${pick}"]`).click()
    await page.getByRole('button', { name: 'Search agents and conversations', exact: true }).click()
    const search = page.getByRole('combobox', { name: 'Search agents and conversations' })
    await search.fill('demo')
    await expect(page.locator('.global-search-agent-match').first()).toBeVisible()
    await search.press('Enter')
    await expect.poll(() => decodeURIComponent(page.url()).split('#')[1]).toBe(`/a/${local.id}`)
    await expect(page.locator('.prompt textarea')).toHaveValue('Unsent tab switching draft')
  }
  // A direct in-app link also stays on the explicitly chosen conversation.
  await page.goto('/#/')
  await page.locator('[data-bar-id="remote"]').click()
  await page.evaluate((id) => {
    const link = document.createElement('a')
    link.href = `#/a/${encodeURIComponent(id)}`
    document.body.append(link)
    link.click()
    link.remove()
  }, local.id)
  await expect.poll(() => decodeURIComponent(page.url()).split('#')[1]).toBe(`/a/${local.id}`)
  await expect(page.locator('.prompt textarea')).toHaveValue('Unsent tab switching draft')
})
