import { expect, test, type FakeCore, type FakeTerminal, type Page } from './fake-core'

// Port of phone-compact-chrome.spec.ts to herdr-core (chromium-phone), on a Claude Code
// terminal. Kept: phone keys in conversation and terminal, identity sizing, the pane
// sheet / Options split and renaming. The split-tab tests run on one tab of two panes
// shown through an injected state (the fake core has no layout documents). Dropped: the
// desktop-only test (the core run is phone only) and SHOTS screenshots.
let claude: FakeTerminal
const agent = (core: FakeCore) => core.claude('demo', [['user', 'Are you ready?'], ['assistant', 'Ready when you are.']])

// One tab holding the Claude terminal and a shell beside it, as a split tab would.
async function splitTab(page: Page, core: FakeCore) {
  const shell = core.shell('demo', { name: 'shell' })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let state: any
  await expect.poll(async () => {
    state = await (await page.request.get('/api/state')).json()
    return state.panes.some((p: { id: string }) => p.id === shell.pane)
  }).toBe(true)
  const chat = state.panes.find((p: { id: string }) => p.id === claude.pane)
  const sh = state.panes.find((p: { id: string }) => p.id === shell.pane)
  state.tabs = state.tabs.filter((t: { id: string }) => t.id !== sh.tab)
  sh.tab = chat.tab
  await page.routeWebSocket('**/ws/events', ws => { ws.send(JSON.stringify(state)) })
  return { chatPane: claude.pane, shellPane: shell.pane }
}

test.beforeEach(async ({ page, core }) => {
  claude = agent(core)
  await page.addInitScript(() => localStorage.setItem('terminalRenderer', 'html'))
  await page.goto(claude.url)
  await expect(page.locator('.chat').getByText('Ready when you are.')).toBeVisible()
})

test('phone keys default closed, preserve mobile keys, and work in conversation and terminal', async ({ page }) => {
  const toggle = page.getByRole('button', { name: 'Show or hide terminal keys', exact: true })
  const bar = page.getByRole('group', { name: 'Terminal function keys', exact: true })
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await expect(bar).toHaveCount(0)
  const closed = (await page.locator('.swipe-area').boundingBox())!.height
  await toggle.click()
  await expect(bar).toBeVisible()
  expect(await page.locator('.xterm-helper-textarea:focus').count()).toBe(0)
  const strip = bar.getByRole('toolbar', { name: 'Common keys and modifiers' })
  expect(await strip.getByRole('button').evaluateAll(buttons => buttons.map(b => b.getAttribute('aria-label')))).toEqual(['Show or hide the phone keyboard', 'Ctrl', 'Esc', 'Tab', 'Left arrow', 'Up arrow', 'Down arrow', 'Right arrow', 'Enter', 'Ctrl+C', 'Backspace', 'Home', 'End', 'PgUp', 'PgDn', 'Delete', 'Insert', 'Alt', 'Shift', 'Y', 'N', ...Array.from({ length: 12 }, (_, i) => `F${i + 1}`)])
  expect((await page.locator('.swipe-area').boundingBox())!.height).toBeLessThan(closed)
  const [keyToggle, send] = await Promise.all([toggle.boundingBox(), page.locator('.prompt-send').boundingBox()])
  expect(keyToggle!.y + keyToggle!.height).toBeLessThanOrEqual(send!.y)
  expect(Math.abs(keyToggle!.x + keyToggle!.width / 2 - send!.x - send!.width / 2)).toBeLessThan(12)
  const [firstKey, prompt] = await Promise.all([strip.getByRole('button').first().boundingBox(), page.locator('.prompt').boundingBox()])
  const gap = prompt!.y - (firstKey!.y + firstKey!.height)
  expect(gap).toBeGreaterThanOrEqual(4); expect(gap).toBeLessThanOrEqual(6)
  const input = page.waitForRequest(r => r.url().endsWith('/api/input') && r.method() === 'POST')
  await strip.getByRole('button', { name: 'Esc', exact: true }).click()
  expect((await input).postDataJSON()).toMatchObject({ pane_id: claude.pane, keys: ['esc'] })
  const keyboard = bar.getByRole('button', { name: 'Show or hide the phone keyboard', exact: true })
  await keyboard.click()
  await expect(page.locator('.composer textarea')).toBeFocused()
  await keyboard.click()
  await expect(page.locator('.composer textarea')).not.toBeFocused()
  for (const [name, keys] of [
    ['Home', ['esc', '[', 'shift+h']], ['End', ['esc', '[', 'shift+f']],
    ['PgUp', ['esc', '[', '5', '~']], ['PgDn', ['esc', '[', '6', '~']],
    ['Insert', ['esc', '[', '2', '~']], ['Delete', ['esc', '[', '3', '~']],
  ] as const) {
    const request = page.waitForRequest(r => r.url().endsWith('/api/input') && r.method() === 'POST')
    await bar.getByRole('button', { name, exact: true }).click()
    expect((await request).postDataJSON()).toEqual({ pane_id: claude.pane, keys: [...keys] })
  }
  // Esc reached core's terminal.keys (Home…Insert do not yet: see the last test).
  await expect.poll(() => claude.keys).toContain('esc')
  await bar.getByRole('button', { name: 'Ctrl', exact: true }).click()
  const modified = page.waitForRequest(r => r.url().endsWith('/api/input') && r.method() === 'POST')
  await bar.getByRole('button', { name: 'Home', exact: true }).click()
  expect((await modified).postDataJSON()).toEqual({ pane_id: claude.pane, keys: ['esc', '[', '1', ';', '5', 'shift+h'] })
  await expect(bar.getByRole('button', { name: 'Ctrl', exact: true })).toHaveAttribute('aria-pressed', 'false')
  await expect(page.locator('#term')).toHaveCount(0)
  await strip.evaluate(el => { el.scrollLeft = 0 })
  const geometry = await strip.getByRole('button').evaluateAll(buttons => buttons.map(b => {
    const r = b.getBoundingClientRect(), hit = getComputedStyle(b, '::after')
    return { x: r.x, y: r.y, w: r.width, h: r.height, hitW: r.width - 2 - parseFloat(hit.left) - parseFloat(hit.right), hitH: r.height - 2 - parseFloat(hit.top) - parseFloat(hit.bottom) }
  }))
  for (const [i, g] of geometry.entries()) {
    expect(g.w).toBeGreaterThanOrEqual(38); expect(g.h).toBe(36)
    expect(g.hitW).toBeGreaterThanOrEqual(44); expect(g.hitH).toBeGreaterThanOrEqual(44)
    expect(g.y).toBe(geometry[0]!.y)
    if (i) {
      const previous = geometry[i - 1]!
      expect(previous.x + previous.w + (previous.hitW - previous.w) / 2).toBeLessThanOrEqual(g.x - (g.hitW - g.w) / 2)
    }
  }
  await page.locator('.mode-btn').click()
  await expect(page.locator('#term .xterm-rows')).toBeVisible()
  await expect(bar).toBeVisible()
  const screen = await page.locator('#term .xterm-screen').boundingBox()
  const keys = await bar.boundingBox()
  expect(screen!.y + screen!.height).toBeLessThanOrEqual(keys!.y)
  const packets: { type: string, keys?: string[], text?: string }[] = []
  page.on('websocket', socket => socket.on('framesent', ({ payload }) => {
    if (socket.url().includes('/ws/term?') && typeof payload === 'string') packets.push(JSON.parse(payload))
  }))
  // Reconnect once so the packet observer sees this terminal's socket.
  await page.reload()
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await expect(page.locator('#term .xterm-rows')).toBeVisible()
  await toggle.click()
  await strip.getByRole('button', { name: 'Shift', exact: true }).click()
  await strip.getByRole('button', { name: 'Left arrow', exact: true }).click()
  await expect.poll(() => packets.flatMap(p => p.keys || [])).toContain('shift+left')
  await strip.getByRole('button', { name: 'Shift', exact: true }).click()
  await strip.getByRole('button', { name: 'Tab', exact: true }).click()
  await expect.poll(() => packets.flatMap(p => p.keys || [])).toContain('shift+tab')
  await expect(bar.getByRole('button', { name: 'PgUp', exact: true })).toBeVisible()
  await expect(bar.getByRole('button', { name: 'F12', exact: true })).toBeAttached()
  for (const [name, bytes] of [['Home', '\x1b[H'], ['End', '\x1b[F'], ['PgUp', '\x1b[5~'], ['PgDn', '\x1b[6~'], ['Insert', '\x1b[2~'], ['Delete', '\x1b[3~']]) {
    await bar.getByRole('button', { name, exact: true }).click()
    await expect.poll(() => packets.filter(p => p.type === 'terminal.input').map(p => p.text)).toContain(bytes)
  }
  await expect(bar.getByRole('button', { name: 'Tab', exact: true })).toHaveCount(1)
  await expect(bar.getByRole('button', { name: 'Shift + Tab', exact: true })).toHaveCount(0)
  for (const key of ['Left arrow', 'Up arrow', 'Down arrow', 'Right arrow', 'Enter', 'Backspace']) {
    const icon = strip.getByRole('button', { name: key, exact: true }).locator('svg')
    await expect(icon).toBeAttached()
    await expect(icon.locator('path').first()).toBeAttached()
  }
  await strip.getByRole('button', { name: 'Shift', exact: true }).click()
  await toggle.click()
  await toggle.click()
  await expect(strip.getByRole('button', { name: 'Shift', exact: true })).toHaveAttribute('aria-pressed', 'false')
})

test('phone identity preserves agent and touch targets at 320, 360 and 412 px, including large text', async ({ page }) => {
  const state = await (await page.request.get('/api/state')).json()
  const pane = state.panes.find((p: { id: string }) => p.id === claude.pane)
  state.workspaces.find((w: { id: string }) => w.id === pane.workspace).label = 'phone'
  state.tabs.find((tab: { id: string }) => tab.id === pane.tab).label = 'phone-scrolling-多个智能体的长标题'
  pane.label = 'phone-scrolling-多个智能体的长标题'
  pane.agent = 'claude'
  pane.status = 'blocked'
  let update = () => {}
  await page.routeWebSocket('**/ws/events', ws => { update = () => ws.send(JSON.stringify(state)); update() })
  await page.reload()
  const identity = page.locator('.phone-identity')
  await expect(identity.locator('.phone-identity-kind')).toHaveText('Claude')
  await expect(identity.locator('.phone-identity-title')).toHaveText('phone-scrolling-多个智能体的长标题')
  for (const width of [320, 360, 412]) {
    await page.setViewportSize({ width, height: 844 })
    for (const scale of [1, 1.3]) {
    await page.evaluate(scale => { document.documentElement.style.fontSize = `${16 * scale}px` }, scale)
    const boxes = await page.locator('#agent .agent-top').evaluate(el => {
      const selectors = ['.back', '.phone-identity', '.mode-btn', '.agent-actions > button:last-child']
      const kind = el.querySelector('.phone-identity-kind')!
      return { width: document.documentElement.clientWidth, kindFits: kind.scrollWidth <= kind.clientWidth, boxes: selectors.map(s => {
        const r = el.querySelector(s)!.getBoundingClientRect()
        return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height }
      }) }
    })
    expect(Math.max(...boxes.boxes.map(b => b.y))).toBeLessThan(Math.min(...boxes.boxes.map(b => b.bottom)))
    expect(boxes.kindFits).toBe(true)
    for (const [i, box] of boxes.boxes.entries()) {
      expect(box.x).toBeGreaterThanOrEqual(0); expect(box.right).toBeLessThanOrEqual(boxes.width)
      expect(box.height).toBeGreaterThanOrEqual(44)
      if (i !== 1) expect(box.width).toBeGreaterThanOrEqual(44)
      if (i) expect(box.x).toBeGreaterThanOrEqual(boxes.boxes[i - 1]!.right)
    }
    await expect(identity.locator('.phone-identity-title')).toHaveCSS('text-overflow', 'ellipsis')
    await expect(page.locator('#agent > .space-tabs')).toHaveCount(0)
    }
  }
  const before = await identity.locator('.phone-identity-title').boundingBox()
  pane.status = 'working'; update()
  await expect(identity).toHaveAccessibleName(/Working/)
  expect(await identity.locator('.phone-identity-title').boundingBox()).toEqual(before)
  // A sibling tab changes neither the selected identity nor its routing.
  const original = state.tabs.find((tab: { id: string }) => tab.id === pane.tab)
  state.tabs.push({ ...original, id: `${pane.workspace}:t2`, label: 'phone-review', number: 2, layout: null })
  state.panes.push({ ...pane, id: `${pane.workspace}:p2`, tab: `${pane.workspace}:t2`, label: 'Review Login' })
  update()
  await expect(identity.locator('.phone-identity-title')).toHaveText('phone-scrolling-多个智能体的长标题')
  await identity.click()
  const details = page.locator('.phone-identity-details')
  await expect(details).toContainText('phone-scrolling-多个智能体的长标题')
  await expect(details.getByRole('button', { name: /^phone-review/ })).toBeVisible()
  // Core keeps only New tab among the tab actions (app/composables/useSpaces.ts).
  await expect(page.getByText('Rename tab', { exact: true })).toHaveCount(0)
  await expect(page.getByText('New tab', { exact: true })).toBeVisible()
  await details.getByRole('button', { name: /^phone-review/ }).click()
  await expect(page).toHaveURL(new RegExp(`${pane.workspace}:p2$`))
  await expect(identity.locator('.phone-identity-title')).toHaveText('Review Login')
})

test('phone identity opens panes before tabs and switches in reading order without opening the keyboard', async ({ page, core }) => {
  const { chatPane: SPLIT_CHAT_PANE, shellPane: SPLIT_SHELL_PANE } = await splitTab(page, core)
  await page.goto(`/#/a/${SPLIT_CHAT_PANE}`)
  await page.reload()
  const identity = page.locator('.phone-identity')
  await expect(identity.locator('.phone-identity-position')).toHaveText('1/2')
  await expect(page.locator('#agent .agent-top')).toHaveCSS('height', '44px')
  await expect(identity.locator('.pill i')).toHaveCSS('width', '7px')
  await expect(identity.locator('.pill i')).toHaveCSS('border-radius', '0px')
  await expect(identity.locator('[class*=circle]')).toHaveCount(0)
  await identity.click()
  const details = page.locator('.phone-identity-details')
  await expect(page.locator('.hw-sheet-close')).toHaveCount(0)
  await expect(details.locator('.phone-identity-summary')).toHaveCSS('white-space', 'nowrap')
  await expect(details.getByText('Panes in this tab', { exact: true })).toBeVisible()
  await expect(details.getByRole('button', { name: /^Tab overview/ })).toBeVisible()
  // No "Close entire space…" on core: the last entry is the tab overview.
  await expect(details.locator('.menu > button').last()).toContainText('Tab overview')
  await details.getByRole('button').filter({ hasText: '2/2' }).click()
  await expect(page).toHaveURL(new RegExp(`${SPLIT_SHELL_PANE}$`))
  await expect(identity.locator('.phone-identity-position')).toHaveText('2/2')
  await expect(identity.locator('.phone-identity-kind')).toHaveCount(0)
  // A core shell reports no state: Unknown, not Shell (app/composables/useActions.ts).
  await expect(identity.locator('.phone-identity-meta')).toHaveText('Unknown')
  expect(await page.locator('textarea:focus,input:focus').count()).toBe(0)
})

// Each action has one place: the identity sheet manages panes and tabs, Options
// keeps the conversation, the agent and its tools.
// On core the tab actions are New tab and Tab overview only (no Rename tab, no Close entire space).
const PANE_TAB_ACTIONS = ['Rename pane', 'Split right', 'Split down', 'Move to…', 'New tab', 'Tab overview', 'Close this conversation']
const sheetItems = (page: Page) => page.locator('.hw-sheet .menu > button .menu-text > span:first-child, .hw-sheet .menu > button:not(:has(.menu-text))').allInnerTexts()

test('phone pane sheet and Options split pane management from agent actions, without duplicates', async ({ page, core }) => {
  for (const split of [false, true]) {
    const paneId = split ? (await splitTab(page, core)).chatPane : claude.pane
    await page.goto(`/#/a/${paneId}`)
    if (split) await page.reload()
    const identity = page.locator('.phone-identity')
    await expect(identity.locator('.phone-identity-chevron')).toBeVisible()
    await expect(identity.locator('.phone-identity-position')).toHaveCount(split ? 1 : 0)
    await expect(identity.locator('.phone-identity-toggle .phone-identity-position')).toHaveCount(split ? 1 : 0)
    // The chevron has the same button box and icon size as the terminal button next to it.
    // Also on narrow phones (below 380 px), where the header buttons keep 44 px.
    const box = async (sel: string) => (await page.locator(sel).boundingBox())!
    const viewport = page.viewportSize()!
    for (const width of [viewport.width, 320]) {
      await page.setViewportSize({ width, height: viewport.height })
      const [toggle, term, chevron, termIcon] = await Promise.all([
        box('.phone-identity-toggle'), box('.agent-actions .mode-btn'), box('.phone-identity-chevron'), box('.agent-actions .mode-btn .iconify'),
      ])
      // A lone pane: the very same box. Several panes: the position (1/2) shares it, so it is wider.
      if (split) expect(toggle.height).toBe(term.height)
      else expect([toggle.width, toggle.height]).toEqual([term.width, term.height])
      expect(toggle.width).toBeGreaterThanOrEqual(44)
      expect(toggle.height).toBeGreaterThanOrEqual(44)
      expect(toggle.y).toBe(term.y)
      expect([chevron.width, chevron.height]).toEqual([termIcon.width, termIcon.height])
    }
    await page.setViewportSize(viewport)
    await identity.click()
    await expect(identity.locator('.phone-identity-toggle')).toHaveClass(/\bon\b/)
    await expect(page.locator('.hw-sheet .menu-group').filter({ hasText: 'Current pane' })).toBeVisible()
    const sheet = (await sheetItems(page)).map(x => x.trim())
    await page.keyboard.press('Escape')
    await expect(page.locator('.hw-sheet')).toHaveCount(0)
    for (const label of PANE_TAB_ACTIONS.filter(x => split || x !== 'Tab overview')) expect(sheet).toContain(label)
    expect(sheet).not.toContain('Close tab')
    expect(sheet).not.toContain('Rename tab')
    expect(sheet.filter(x => x === 'Copy pane ID')).toHaveLength(1)
    await expect(page.locator('.menu-group').filter({ hasText: 'Panes in this tab' })).toHaveCount(0)

    await page.getByRole('button', { name: 'Options', exact: true }).click()
    await expect(page.locator('.hw-sheet').getByText('Reconnect', { exact: true })).toBeVisible()
    const options = (await sheetItems(page)).map(x => x.trim())
    await page.keyboard.press('Escape')
    // Core's menu (app/utils/coreAgentMenu.ts): no Search, View changes or notification entry yet.
    for (const label of ['Take control of this terminal', 'Reconnect', 'Browse files', 'Settings']) expect(options).toContain(label)
    expect(options.filter(x => sheet.includes(x))).toEqual([])
    for (const label of [...PANE_TAB_ACTIONS, 'Copy pane ID', 'Close tab', 'Close entire space…']) expect(options).not.toContain(label)
    expect(options.some(x => x.startsWith('Close'))).toBe(false)
  }
})

test('phone pane sheet renames the pane of a lone pane', async ({ page, core }) => {
  // Through the real route: core gets the name as a label of the terminal.
  const rename = page.waitForRequest(r => r.url().endsWith('/api/rename') && r.method() === 'POST')
  const identity = page.locator('.phone-identity')
  await identity.click()
  await page.locator('.hw-sheet').getByRole('button', { name: 'Rename pane', exact: true }).click()
  await page.getByPlaceholder('Pane name (empty = automatic name)').fill('build notes')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  expect((await rename).postDataJSON()).toEqual({ pane_id: claude.pane, label: 'build notes' })
  await expect.poll(() => JSON.stringify(core.calls.filter(c => c.method === 'terminal.label'))).toContain('build notes')
  await expect(page.getByPlaceholder('Pane name (empty = automatic name)')).toHaveCount(0)
})

// Known gap on core, found by this port: from the conversation (no terminal attached), the key
// bar sends Home, End, PgUp, PgDn, Insert and Delete as the CSI bytes of v2 Herdr's named-key
// workaround (app/utils/keybarKeys.ts), e.g. ['esc', '[', '5', '~']. Core's /api/input refuses
// "[" and "~" (KEY_RE in server/utils/coreInput.ts): 400 bad_keys. Which key names hc's
// terminal.keys accepts for these is not settled yet, so this stays an expected failure; it
// starts passing (and must lose `test.fail`) once those keys reach core.
test('conversation key bar: Home and PgUp reach core', async ({ page }) => {
  test.fail()
  await page.getByRole('button', { name: 'Show or hide terminal keys', exact: true }).click()
  const bar = page.getByRole('group', { name: 'Terminal function keys', exact: true })
  for (const name of ['Home', 'PgUp']) {
    const response = page.waitForResponse(r => r.url().endsWith('/api/input') && r.request().method() === 'POST')
    await bar.getByRole('button', { name, exact: true }).click()
    expect((await response).status()).toBe(200)
  }
  expect(claude.keys.length).toBeGreaterThan(0)
})
