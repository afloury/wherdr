import { type Locator, type Page, expect, test } from '@playwright/test'
import { SPLIT_CHAT_PANE, SPLIT_SHELL_PANE, SPLIT_TAB, fakeHerdr } from './scenario.mjs'

// Panes side by side on a computer: the terminal of the focused cell is the real
// one, fitted to the cell (it used to be a mirror at the pane's own size: 80
// columns in the corner of a cell twice as wide). The other cells mirror their
// pane; a pane fitted by its cell keeps that size while the tab shows it, and
// gets its own back afterwards.
test.skip(({ isMobile }) => isMobile, 'side-by-side cells are a computer layout')

// The fake panes start at 120x40 and keep the size a control session gave them.
const ORIGINAL = { cols: 120, rows: 40, attached: false }
const paneSize = (pane: string) => fakeHerdr('e2e.pane_size', { pane_id: pane }) as Promise<{ cols: number, rows: number, attached: boolean }>

const shot = (page: Page, name: string, project: string) =>
  process.env.SHOTS ? page.screenshot({ path: `${process.env.SHOTS}/${project}-${name}.png` }) : Promise.resolve()

const cell = (page: Page, pane: string) => page.locator(`.cell-view[data-pane="${pane}"]`)

async function open(page: Page, width: number, height: number) {
  // DOM renderer: the terminal's text is in the page.
  await page.addInitScript(() => localStorage.setItem('terminalRenderer', 'html'))
  await page.setViewportSize({ width, height })
  await page.goto(`/#/t/${SPLIT_TAB}`)
  await expect(page.locator('.cell-view')).toHaveCount(2)
}

// The screen leaves less than one character (and the terminal's padding) free
// on each axis of its cell's body.
async function expectFilled(body: Locator, cols: number, rows: number) {
  const m = await body.evaluate((el) => {
    const s = el.querySelector('.xterm-screen') as HTMLElement
    return { boxW: el.clientWidth, boxH: el.clientHeight, w: s.offsetWidth, h: s.offsetHeight }
  })
  expect(m.w).toBeGreaterThan(m.boxW - 20 - m.w / cols - 1)
  expect(m.w).toBeLessThanOrEqual(m.boxW)
  expect(m.h).toBeGreaterThan(m.boxH - 12 - m.h / rows - 1)
  expect(m.h).toBeLessThanOrEqual(m.boxH)
  return m
}

test.beforeEach(async () => {
  for (const pane of [SPLIT_CHAT_PANE, SPLIT_SHELL_PANE]) await expect.poll(() => paneSize(pane), { timeout: 15_000 }).toEqual(ORIGINAL)
})

for (const [width, height] of [[1440, 900], [2000, 1125]] as const) {
  test(`the terminal of the focused cell fills the cell (${width} px)`, async ({ page }, testInfo) => {
    await open(page, width, height)
    const chat = cell(page, SPLIT_CHAT_PANE)
    await expect(chat.locator('.chat').getByText('It runs in the pane on the right.')).toBeVisible()
    await shot(page, `split-terminal-${width}-conversation`, testInfo.project.name)

    await chat.getByRole('tab', { name: 'Terminal' }).click()
    await expect(chat.locator('#term .xterm-rows')).toContainText('fake terminal')
    await expect.poll(async () => (await paneSize(SPLIT_CHAT_PANE)).attached).toBe(true)
    const size = await paneSize(SPLIT_CHAT_PANE)
    await expect(chat.locator('#term .xterm-rows')).toContainText(`fake terminal ${size.cols}x${size.rows}`)
    const m = await expectFilled(chat.locator('#termWrap'), size.cols, size.rows)
    // The whole cell, not the reading column of a pane opened alone (760 px).
    if (width === 2000) expect(m.w).toBeGreaterThan(780)
    await shot(page, `split-terminal-${width}`, testInfo.project.name)
  })
}

test('the terminal follows its cell when the window is resized', async ({ page }) => {
  await open(page, 2000, 1125)
  const shell = cell(page, SPLIT_SHELL_PANE)
  await shell.click()
  await expect(shell.locator('#term .xterm-rows')).toContainText('fake terminal')
  await expect.poll(async () => (await paneSize(SPLIT_SHELL_PANE)).attached).toBe(true)
  const wide = await paneSize(SPLIT_SHELL_PANE)

  await page.setViewportSize({ width: 1440, height: 900 })
  await expect.poll(async () => (await paneSize(SPLIT_SHELL_PANE)).cols).toBeLessThan(wide.cols)
  const narrow = await paneSize(SPLIT_SHELL_PANE)
  expect(narrow.rows).toBeLessThan(wide.rows)
  await expect(shell.locator('#term .xterm-rows')).toContainText(`fake terminal ${narrow.cols}x${narrow.rows}`)
  await expectFilled(shell.locator('#termWrap'), narrow.cols, narrow.rows)
})

test('a cell that loses the focus mirrors its pane at the size it was fitted to', async ({ page }, testInfo) => {
  await open(page, 1440, 900)
  const shell = cell(page, SPLIT_SHELL_PANE)
  // Not focused, never fitted: the pane as it is, framed in its cell.
  await expect(shell.locator('.mirror .xterm-rows')).toContainText('fake mirror')
  await expect(shell.locator('.mirror-tag')).toContainText('Mirror')
  expect(await paneSize(SPLIT_SHELL_PANE)).toEqual(ORIGINAL)

  await shell.click()
  await expect(shell.locator('#term .xterm-rows')).toContainText('fake terminal')
  await expect.poll(async () => (await paneSize(SPLIT_SHELL_PANE)).attached).toBe(true)
  const fitted = await paneSize(SPLIT_SHELL_PANE)

  // The focus goes to the other cell: a mirror again, of the fitted pane.
  await cell(page, SPLIT_CHAT_PANE).locator('.chat').click()
  await expect(shell.locator('.mirror .xterm-rows')).toContainText(`fake mirror ${fitted.cols}x${fitted.rows}`)
  await expect(shell.locator('.mirror-tag')).toHaveText(`Mirror · ${fitted.cols}×${fitted.rows}`)
  await expectFilled(shell.locator('.mirror'), fitted.cols, fitted.rows)
  // Longer than the delay after a closed terminal: the size was not given back.
  await page.waitForTimeout(3000)
  expect(await paneSize(SPLIT_SHELL_PANE)).toEqual({ cols: fitted.cols, rows: fitted.rows, attached: false })
  await shot(page, 'split-terminal-mirror', testInfo.project.name)

  // Its cell resized meanwhile: fitted again, without the focus.
  await page.setViewportSize({ width: 1200, height: 800 })
  await expect.poll(async () => (await paneSize(SPLIT_SHELL_PANE)).cols, { timeout: 15_000 }).toBeLessThan(fitted.cols)
  const again = await paneSize(SPLIT_SHELL_PANE)
  await expect(shell.locator('.mirror-tag')).toHaveText(`Mirror · ${again.cols}×${again.rows}`)

  // The tab is left: the pane gets the size it had before wherdr showed it.
  await page.goto('/#/')
  await expect.poll(() => paneSize(SPLIT_SHELL_PANE), { timeout: 10_000 }).toEqual(ORIGINAL)
})
