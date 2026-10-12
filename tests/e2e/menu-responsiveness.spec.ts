import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { OMP_CHAT_PANE as pane, fakeHerdr } from './scenario.mjs'
const fx = (name: string) => readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8')
const show = (text: string | null, agent: string, transitions = {}) => fakeHerdr('e2e.interaction_screen', { pane_id: pane, text, agent, status: 'blocked', transitions })
test.afterEach(async ({ request }) => {
  await fakeHerdr('e2e.interaction_screen', { pane_id: pane, text: null, agent: 'omp', status: 'idle' })
  await expect.poll(async () => {
    const state = await (await request.get('/api/state')).json()
    return state.panes.find((p: { id: string }) => p.id === pane)?.agent
  }).toBe('omp')
})
test('MCP arrow paints immediately even while the navigation request is held', async ({ page }, info) => {
  test.skip(!info.project.name.includes('desktop'), 'Card keyboard needs a hardware keyboard')
  const text = fx('claude-mcp.ansi')
  const moved = text.replace('❯ ✔ Docs', '  ✔ Docs').replace('     ✔ Calendar', '   ❯ ✔ Calendar')
  await show(text, 'claude', { down: moved })
  await page.goto(`/#/a/${pane}`)
  await expect(page.locator('.menu-list .cur')).toContainText('Docs')
  let release!: () => void
  const held = new Promise<void>(r => { release = r })
  await page.route('**/api/nav', async route => { await held; await route.continue() })
  await page.locator('.choices-q').click()
  const started = Date.now()
  await page.keyboard.press('ArrowDown')
  await expect(page.locator('.menu-list .cur')).toContainText('Calendar')
  console.log(`MCP optimistic selection: ${Date.now() - started}ms (request held)`)
  release()
  await expect.poll(async () => (await fakeHerdr('e2e.terminal_screen', { pane_id: pane })).keys).toEqual(['down'])
  await expect.poll(async () => {
    const state = await (await page.request.get('/api/state')).json()
    const menu = state.panes.find((p: { id: string }) => p.id === pane)?.menu
    return menu?.items[menu.cursor]?.label
  }).toContain('Calendar')
  await page.screenshot({ path: `.shots/menu-responsive-${info.project.name}.png` })
})
test('usage subtitle opens the real terminal and its arrows update the live frame', async ({ page }, info) => {
  const raw = fx('codex-usage-subtitle.txt')
  const text = raw.replace(/› 1\..*$/m, '\x1b[7m$&\x1b[0m')
  const moved = raw.replace('› 1.', '  1.').replace('  2.', '› 2.').replace(/› 2\..*$/m, '\x1b[7m$&\x1b[0m')
  await show(text, 'codex', { down: moved })
  await page.addInitScript(() => localStorage.setItem('terminalRenderer', 'html'))
  await page.goto(`/#/a/${pane}`)
  const window = page.locator('.interactive-terminal')
  await expect(window.locator('.xterm-rows')).toContainText('Account usage and resets.')
  await expect(page.locator('.choices-list')).toHaveCount(0)
  await expect(page.locator('.hw-sheet')).toHaveCount(0)
  const started = Date.now()
  await window.getByRole('button', { name: '↓', exact: true }).click()
  await expect(window.locator('.xterm-rows')).toContainText('› 2. Redeem reset')
  console.log(`Codex live selection: ${Date.now() - started}ms`)
  expect((await fakeHerdr('e2e.terminal_screen', { pane_id: pane })).keys).toEqual(['down'])
  await page.screenshot({ path: `.shots/usage-responsive-${info.project.name}.png` })
  await window.getByRole('button', { name: 'esc', exact: true }).click()
  await expect(window).toHaveCount(0)
})
test('config list gives focus back to tabs before switching', async ({ page }, info) => {
  const config = fx('claude-config-list.ansi')
  const focused = config.replace('   ❯ Auto-compact', '     Auto-compact').replace('Type to filter · Enter/↓ to select · ↑ to tabs · Esc to clear', '←/→/tab to switch · ↓ to return · Esc to close')
  const status = fx('claude-settings-status.txt').replace('Status   Config', '\x1b[7mStatus\x1b[0m   Config')
  await fakeHerdr('e2e.interaction_screen', { pane_id: pane, text: fx('claude-idle.txt'), agent: 'claude', status: 'idle' })
  await expect.poll(async () => {
    const s = await (await page.request.get('/api/state')).json()
    const p = s.panes.find((p: { id: string }) => p.id === pane)
    return { interaction: p?.interaction, agent: p?.agent }
  }).toEqual({ interaction: 'input', agent: 'claude' })
  await page.goto(`/#/a/${pane}`)
  await page.route('**/api/prompt', async route => {
    const response = await route.fetch()
    await show(config, 'claude', { up: focused, left: status })
    await route.fulfill({ response })
  })
  const field = page.locator('.prompt').locator('textarea, [contenteditable="true"]').first()
  await field.fill('/config')
  await page.locator('.slash-menu .slash-item', { hasText: '/config' }).first().click()
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await expect(page.getByRole('tab', { name: 'Config', exact: true })).toHaveAttribute('aria-selected', 'true')
  await page.getByRole('tab', { name: 'Status', exact: true }).click()
  await expect(page.getByRole('tab', { name: 'Status', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect(page.locator('.hw-sheet .screen')).toContainText('Version:')
  expect((await fakeHerdr('e2e.terminal_screen', { pane_id: pane })).keys).toEqual(['up', 'left'])
  const result = await (await page.request.get(`/api/screen?pane=${encodeURIComponent(pane)}`)).json()
  expect(result.tab).toBe('Status')
  await page.screenshot({ path: `.shots/config-responsive-${info.project.name}.png` })
  const stats = fx('claude-settings-stats.txt').replace('   Stats', '   \x1b[7mStats\x1b[0m')
  await show(fx('claude-settings-usage.ansi'), 'claude', { right: stats })
  await page.getByRole('tab', { name: 'Stats', exact: true }).click()
  await expect(page.locator('.hw-sheet .screen')).toContainText('Sessions: 42')
  // The live tab was Usage, even though the last client snapshot was Status.
  expect((await fakeHerdr('e2e.terminal_screen', { pane_id: pane })).keys).toEqual(['right'])
})

test('a late permissions card dismisses the old command snapshot and receives arrows', async ({ page }, info) => {
  const idle = '› Ask Codex to do anything\n\n  GPT-6-Sol medium · demo\n  ? for shortcuts'
  const permissions = fx('codex-permissions.txt')
  await fakeHerdr('e2e.interaction_screen', { pane_id: pane, text: idle, agent: 'codex', status: 'idle' })
  await expect.poll(async () => {
    const s = await (await page.request.get('/api/state')).json()
    const p = s.panes.find((p: { id: string }) => p.id === pane)
    return { interaction: p?.interaction, agent: p?.agent }
  }).toEqual({ interaction: 'input', agent: 'codex' })
  await page.goto(`/#/a/${pane}`)
  // Simulate a first visible read taken before Codex draws the menu.
  let firstRead!: () => void
  const read = new Promise<void>(r => { firstRead = r })
  await page.route('**/api/screen?*', async route => {
    await route.fulfill({ json: { text: idle, tabs: null, tab: null, interaction: 'input' } })
    firstRead()
  })
  const field = page.locator('.prompt').locator('textarea, [contenteditable="true"]').first()
  await field.fill('/perm')
  await page.locator('.slash-menu .slash-item', { hasText: '/permissions' }).first().click()
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await read
  await expect(page.locator('.hw-sheet')).toBeVisible()
  await show(permissions, 'codex', { down: permissions.replace('› 2.', '  2.').replace('  3.', '› 3.') })
  await expect(page.locator('.choices-list')).toContainText('Approve for me')
  await expect(page.locator('.hw-sheet')).toHaveCount(0)
  if (info.project.name.includes('desktop')) {
    await page.locator('.choices-q').click()
    await page.keyboard.press('ArrowDown')
    await expect(page.locator('.choices-list .cur')).toContainText('Full Access')
    await expect.poll(async () => (await fakeHerdr('e2e.terminal_screen', { pane_id: pane })).keys).toEqual(['down'])
  }
  await page.screenshot({ path: `.shots/permissions-responsive-${info.project.name}.png` })
})
