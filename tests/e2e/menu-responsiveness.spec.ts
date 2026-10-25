import { readFileSync } from 'node:fs'
import { expect, test } from './test'
import { OMP_CHAT_PANE as pane, OMP_IMAGE_PANE as OTHER, fakeHerdr } from './scenario.mjs'
const fx = (name: string) => readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8')
const show = (text: string | null, agent: string, transitions = {}) => fakeHerdr('e2e.interaction_screen', { pane_id: pane, text, agent, status: 'blocked', transitions })
test.afterEach(async ({ request }) => {
  await fakeHerdr('e2e.interaction_screen', { pane_id: pane, text: null, agent: 'omp', status: 'idle' })
  await expect.poll(async () => {
    const state = await (await request.get('/api/state')).json()
    return state.panes.find((p: { id: string }) => p.id === pane)?.agent
  }).toBe('omp')
})
test('MCP arrow paints immediately even while the navigation request is held', { tag: '@chromium-desktop' }, async ({ page }, info) => {
  test.skip(!info.project.name.includes('desktop'), 'Card keyboard needs a hardware keyboard')
  const text = fx('claude-mcp.ansi')
  const moved = text.replace('❯ ✔ Docs', '  ✔ Docs').replace('     ✔ Calendar', '   ❯ ✔ Calendar')
  await fakeHerdr('e2e.pane_status', { pane_id: OTHER, status: 'idle' })
  // An idle pane is exposed as done while its last reply is unread.
  await expect.poll(async () => (await (await page.request.get('/api/state')).json()).panes.find((p: { id: string }) => p.id === OTHER)?.status).toMatch(/^(idle|done)$/)
  let receivedWorking!: () => void
  const workingFrame = new Promise<void>(resolve => { receivedWorking = resolve })
  page.on('websocket', ws => {
    if (!ws.url().endsWith('/ws/events')) return
    ws.on('framereceived', ({ payload }) => {
      const state = JSON.parse(String(payload))
      if (state.panes?.some((p: { id: string, status: string }) => p.id === OTHER && p.status === 'working')) receivedWorking()
    })
  })
  await show(text, 'claude', { down: moved })
  await page.goto(`/#/a/${pane}`)
  await expect(page.locator('.menu-list .cur')).toContainText('Docs')
  // Send keyboard gestures only while the menu controls are enabled.
  await expect(page.locator('.menu-list .cur')).toBeEnabled()
  let release!: () => void
  const held = new Promise<void>(r => { release = r })
  let navStarted!: () => void
  const navigation = new Promise<void>(resolve => { navStarted = resolve })
  await page.route('**/api/nav', async route => { navStarted(); await held; await route.continue() })
  try {
    await page.locator('.choices-q').click()
    const started = Date.now()
    await page.keyboard.press('ArrowDown')
    await expect(page.locator('.menu-list .cur')).toContainText('Calendar')
    console.log(`MCP optimistic selection: ${Date.now() - started}ms (request held)`)
    await navigation
    expect((await fakeHerdr('e2e.terminal_screen', { pane_id: pane })).keys).toEqual([])
    // The server keeps broadcasting its state meanwhile (another agent moves):
    // the same menu, read again, must not put the cursor back before the key lands.
    await fakeHerdr('e2e.pane_status', { pane_id: OTHER, status: 'working' })
    await workingFrame
    // Let Vue consume the delivered frame before checking the predicted cursor.
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
    await expect(page.locator('.menu-list .cur')).toContainText('Calendar')
    await fakeHerdr('e2e.pane_status', { pane_id: OTHER, status: 'idle' })
    release()
    await expect.poll(async () => (await fakeHerdr('e2e.terminal_screen', { pane_id: pane })).keys).toEqual(['down'])
    await expect.poll(async () => {
      const state = await (await page.request.get('/api/state')).json()
      const menu = state.panes.find((p: { id: string }) => p.id === pane)?.menu
      return menu?.items[menu.cursor]?.label
    }).toContain('Calendar')
    await page.screenshot({ path: `.shots/menu-responsive-${info.project.name}.png` })
  } finally {
    release()
    await fakeHerdr('e2e.pane_status', { pane_id: OTHER, status: 'idle' })
  }
})
test('usage subtitle opens the real terminal and its arrows update the live frame', { tag: ['@chromium-desktop', '@webkit-desktop'] }, async ({ page }, info) => {
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
