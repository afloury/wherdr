import { claudeScreen, expect, test, type Page } from './fake-core'

// The terminal view on herdr-core, ported from terminal-size.spec.ts and view-toggle.spec.ts:
// the live terminal attaches over the framed protocol (terminal.attach), shows the screen,
// sends what is typed, follows the screen size and detaches when the conversation returns.
// Not repeated here: the desktop Conversation / Terminal button and its Ctrl+` shortcut
// (components/ViewToggle, shortcuts.test.ts, viewMode.test.ts). Dropped from v2: the grace
// delay after a dropped connection and the reopen-at-once case (core restores the size
// itself on detach), and the split-cell toggle (no split tabs on core).
// Claude Code's own screen: another screen would be taken for a full-screen program.
const SCREEN = `fake terminal ready\n\n${claudeScreen()}`

// DOM renderer: the terminal's text is in the page.
const domRenderer = (page: Page) => page.addInitScript(() => localStorage.setItem('terminalRenderer', 'html'))

test('the phone Terminal view attaches, sends typed keys, follows the size and detaches', async ({ page, core }) => {
  const claude = core.claude('demo', [['user', 'Are you ready?'], ['assistant', 'Ready when you are.']], { screen: SCREEN })
  await domRenderer(page)
  await page.goto(claude.url)
  await expect(page.locator('.chat').getByText('Ready when you are.')).toBeVisible()
  await page.locator('button[aria-label="Terminal"]').first().click()
  // The terminal's frames reach the screen.
  await expect(page.locator('#term .xterm-rows')).toContainText('fake terminal ready')
  await expect.poll(() => claude.size.attached).toBe(true)
  const open = { ...claude.size }
  expect(open.cols).toBeLessThan(60)

  // Typed text goes to core as the terminal's input.
  await page.locator('.xterm-helper-textarea').focus()
  await page.keyboard.type('ls -la')
  await page.keyboard.press('Enter')
  await expect.poll(() => claude.typed).toContain('ls -la\r')

  // A resize of the open terminal (rotation, keyboard) is followed.
  await page.setViewportSize({ width: page.viewportSize()!.width, height: page.viewportSize()!.height - 160 })
  await expect.poll(() => claude.size.rows).toBeLessThan(open.rows)
  await page.setViewportSize({ width: page.viewportSize()!.width, height: page.viewportSize()!.height + 160 })
  await expect.poll(() => claude.size.rows).toBe(open.rows)

  // Back to the conversation: the terminal is closed, core lets go of it.
  await page.locator('button[aria-label="Terminal"]').first().click()
  await expect(page.locator('#term')).toHaveCount(0)
  await expect(page.locator('.chat .chat-list article').last()).toBeVisible()
  await expect.poll(() => claude.size.attached, { timeout: 10_000 }).toBe(false)
})
