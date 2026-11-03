import { expect, test, type FakeTerminal } from './fake-core'

// Phone chrome on herdr-core (from phone-compact-chrome.spec.ts): what needs a real browser,
// i.e. layout, touch targets and the live terminal. Covered elsewhere and so not repeated here:
// the key order (components/PhoneKeybar), the navigation keys reaching core from the
// conversation (core-keybar.spec.ts), the identity text and the pane / Options menus without
// Split, Move to or a second Rename (components/PhoneIdentity, CorePaneMenus,
// core-agent-menu.test.ts).
let claude: FakeTerminal

test.beforeEach(async ({ page, core }) => {
  claude = core.claude('demo', [['user', 'Are you ready?'], ['assistant', 'Ready when you are.']])
  await page.addInitScript(() => localStorage.setItem('terminalRenderer', 'html'))
  await page.goto(claude.url)
  await expect(page.locator('.chat').getByText('Ready when you are.')).toBeVisible()
})

test('phone keys: closed by default, finger-sized, and working in conversation and terminal', async ({ page }) => {
  const toggle = page.getByRole('button', { name: 'Show or hide terminal keys', exact: true })
  const bar = page.getByRole('group', { name: 'Terminal function keys', exact: true })
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await expect(bar).toHaveCount(0)
  const closed = (await page.locator('.swipe-area').boundingBox())!.height
  await toggle.click()
  await expect(bar).toBeVisible()
  expect(await page.locator('.xterm-helper-textarea:focus').count()).toBe(0)
  const strip = bar.getByRole('toolbar', { name: 'Common keys and modifiers' })
  // The bar takes room from the conversation and sits right above the field.
  expect((await page.locator('.swipe-area').boundingBox())!.height).toBeLessThan(closed)
  const [keyToggle, send] = await Promise.all([toggle.boundingBox(), page.locator('.prompt-send').boundingBox()])
  expect(keyToggle!.y + keyToggle!.height).toBeLessThanOrEqual(send!.y)
  expect(Math.abs(keyToggle!.x + keyToggle!.width / 2 - send!.x - send!.width / 2)).toBeLessThan(12)
  const [firstKey, prompt] = await Promise.all([strip.getByRole('button').first().boundingBox(), page.locator('.prompt').boundingBox()])
  const gap = prompt!.y - (firstKey!.y + firstKey!.height)
  expect(gap).toBeGreaterThanOrEqual(4); expect(gap).toBeLessThanOrEqual(6)
  // Every key: one row, 36 px tall, a 44 px touch area that never overlaps its neighbour's.
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
  // Conversation: a key goes to core's terminal.keys; the keyboard button opens the field's keyboard.
  await strip.getByRole('button', { name: 'Esc', exact: true }).click()
  await expect.poll(() => claude.keys).toContain('esc')
  const keyboard = bar.getByRole('button', { name: 'Show or hide the phone keyboard', exact: true })
  await keyboard.click()
  await expect(page.locator('.composer textarea')).toBeFocused()
  await keyboard.click()
  await expect(page.locator('.composer textarea')).not.toBeFocused()
  await expect(page.locator('#term')).toHaveCount(0)

  // Terminal: the bar stays under the screen; a named chord goes to terminal.keys, a navigation
  // key as the terminal's own input bytes.
  await page.locator('.mode-btn').click()
  await expect(page.locator('#term .xterm-rows')).toBeVisible()
  await expect(bar).toBeVisible()
  const screen = await page.locator('#term .xterm-screen').boundingBox()
  expect(screen!.y + screen!.height).toBeLessThanOrEqual((await bar.boundingBox())!.y)
  await expect.poll(() => claude.size.attached).toBe(true)
  await strip.getByRole('button', { name: 'Shift', exact: true }).click()
  await strip.getByRole('button', { name: 'Tab', exact: true }).click()
  await bar.getByRole('button', { name: 'PgUp', exact: true }).click()
  await expect.poll(() => claude.keys).toContain('shift+tab')
  await expect.poll(() => claude.typed).toContain('\x1b[5~')
})

test('phone identity keeps its touch targets at 320, 360 and 412 px with large text, and renames the pane', async ({ page, core }) => {
  const identity = page.locator('.phone-identity')
  for (const width of [320, 360, 412]) {
    await page.setViewportSize({ width, height: 844 })
    for (const scale of [1, 1.3]) {
      await page.evaluate(scale => { document.documentElement.style.fontSize = `${16 * scale}px` }, scale)
      const boxes = await page.locator('#agent .agent-top').evaluate((el) => {
        const selectors = ['.back', '.phone-identity', '.mode-btn', '.agent-actions > button:last-child']
        return { width: document.documentElement.clientWidth, boxes: selectors.map((s) => {
          const r = el.querySelector(s)!.getBoundingClientRect()
          return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height }
        }) }
      })
      expect(Math.max(...boxes.boxes.map(b => b.y))).toBeLessThan(Math.min(...boxes.boxes.map(b => b.bottom)))
      for (const [i, box] of boxes.boxes.entries()) {
        expect(box.x).toBeGreaterThanOrEqual(0); expect(box.right).toBeLessThanOrEqual(boxes.width)
        expect(box.height).toBeGreaterThanOrEqual(44)
        if (i !== 1) expect(box.width).toBeGreaterThanOrEqual(44)
        if (i) expect(box.x).toBeGreaterThanOrEqual(boxes.boxes[i - 1]!.right)
      }
      await expect(identity.locator('.phone-identity-title')).toHaveCSS('text-overflow', 'ellipsis')
    }
  }
  await page.evaluate(() => { document.documentElement.style.fontSize = '' })
  // Rename from the pane sheet, through the real route: core gets the name as a terminal label.
  await identity.click()
  await page.locator('.hw-sheet').getByRole('button', { name: 'Rename pane', exact: true }).click()
  await page.getByPlaceholder('Pane name (empty = automatic name)').fill('build notes')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect.poll(() => JSON.stringify(core.calls.filter(c => c.method === 'terminal.label'))).toContain('build notes')
  await expect(page.getByPlaceholder('Pane name (empty = automatic name)')).toHaveCount(0)
})
