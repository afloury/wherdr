import { expect, test, type Browser } from '@playwright/test'
import { CLAUDE_PANE, OMP_CHAT_PANE, SPLIT_TAB } from './scenario.mjs'

// iPad sizes in WebKit (touch, iPadOS Safari user agent). Run once, in the
// WebKit desktop project: the contexts below set their own device.
const IPAD_UA = 'Mozilla/5.0 (iPad; CPU OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6 Mobile/15E148 Safari/604.1'
const sizes = { mini: { width: 744, height: 1133 }, portrait: { width: 820, height: 1180 }, landscape: { width: 1180, height: 820 } }

// The screen is the iPad's, in portrait: the window may get shorter (keyboard), the screen does not.
async function ipad(browser: Browser, viewport: { width: number, height: number }) {
  const screen = { width: Math.min(viewport.width, viewport.height), height: Math.max(viewport.width, viewport.height) }
  const ctx = await browser.newContext({
    viewport, screen, isMobile: true, hasTouch: true, userAgent: IPAD_UA, deviceScaleFactor: 1,
    serviceWorkers: 'block', baseURL: test.info().project.use.baseURL, locale: 'en-US', timezoneId: 'UTC',
  })
  return { ctx, page: await ctx.newPage() }
}

test.beforeEach(() => {
  test.skip(test.info().project.name !== 'webkit-desktop', 'iPad contexts are created by the spec itself')
})

for (const name of ['mini', 'portrait'] as const) {
  test(`iPad ${name}: sidebar layout, list slides over the conversation`, { tag: '@webkit-desktop' }, async ({ browser }) => {
    const { ctx, page } = await ipad(browser, sizes[name])
    // Home: no agent to show, the list is open.
    await page.goto('/')
    const home = page.locator('#home')
    await expect(home).toHaveClass(/drawer/)
    await expect(page.locator('.list-scrim')).toBeVisible()

    // An agent: the list folds to the narrow column, the conversation takes the rest.
    await page.goto(`/#/a/${CLAUDE_PANE}`)
    await expect(home).toHaveClass(/rail/)
    await expect(page.locator('.list-scrim')).toHaveCount(0)
    const rail = (await home.boundingBox())!
    const agent = (await page.locator('#agent').boundingBox())!
    expect(rail.width).toBeLessThanOrEqual(60)
    expect(agent.x).toBeLessThanOrEqual(60)
    expect(agent.width).toBeGreaterThan(sizes[name].width - 70)
    await expect(page.locator('#btnBack')).toBeHidden()

    // Touch targets: 44 px.
    const toggle = page.locator('.home-rail .rail-toggle')
    const box = (await toggle.boundingBox())!
    expect(box.width).toBeGreaterThanOrEqual(44)
    expect(box.height).toBeGreaterThanOrEqual(44)

    // Open the list: over the conversation, which keeps its place.
    await toggle.tap()
    await expect(home).toHaveClass(/drawer/)
    expect((await page.locator('#agent').boundingBox())!.x).toBe(agent.x)
    // Tap outside: closed.
    await page.locator('.list-scrim').tap({ position: { x: sizes[name].width - 40, y: sizes[name].height / 2 } })
    await expect(home).toHaveClass(/rail/)

    // Pick another agent from the list: it opens and the list closes.
    await toggle.tap()
    await home.locator('.card', { hasText: 'docs-site' }).first().tap()
    await expect(home).toHaveClass(/rail/)
    await expect(page).toHaveURL(/#\/a\//)
    expect(page.url()).not.toContain(CLAUDE_PANE)

    // Escape (hardware keyboard) closes the list too.
    await toggle.tap()
    await expect(home).toHaveClass(/drawer/)
    await page.keyboard.press('Escape')
    await expect(home).toHaveClass(/rail/)
    await ctx.close()
  })
}

test('iPad landscape: list docked beside the conversation, 44 px targets', { tag: '@webkit-desktop' }, async ({ browser }) => {
  const { ctx, page } = await ipad(browser, sizes.landscape)
  await page.goto(`/#/a/${CLAUDE_PANE}`)
  const home = page.locator('#home')
  await expect(home).not.toHaveClass(/rail|drawer/)
  const side = (await home.boundingBox())!
  expect(side.width).toBeGreaterThanOrEqual(280)
  expect((await page.locator('#agent').boundingBox())!.x).toBeGreaterThanOrEqual(side.width - 1)
  await expect(page.locator('.home-title-row .display')).toBeVisible()
  // The title is not cut by the larger buttons.
  const cut = await page.locator('.home-title-row .display').evaluate(el => el.scrollWidth > el.clientWidth)
  expect(cut).toBe(false)
  for (const b of await page.locator('.home-actions .icon-btn').all()) {
    const r = (await b.boundingBox())!
    expect(r.height).toBeGreaterThanOrEqual(44)
  }
  await ctx.close()
})

test('iPad: Enter adds a line until a hardware keyboard is proven, then sends', { tag: '@webkit-desktop' }, async ({ browser }) => {
  const { ctx, page } = await ipad(browser, sizes.portrait)
  await page.goto(`/#/a/${OMP_CHAT_PANE}`)
  await expect(page.locator('.chat').getByText('Ready when you are.')).toBeVisible()
  const field = page.locator('.prompt').locator('textarea').first()
  await field.click()
  // No proof (e.g. the floating on-screen keyboard, which leaves the page size alone).
  await page.keyboard.type('first line')
  await page.keyboard.press('Enter')
  await expect(field).toHaveValue('first line\n')
  await field.fill('')
  // An arrow key: only a hardware keyboard sends it.
  const text = `From the iPad keyboard ${Date.now()}`
  await page.keyboard.type(text)
  await page.keyboard.press('ArrowLeft')
  await page.keyboard.press('End')
  await page.keyboard.press('Enter')
  await expect(page.locator('.msg-user', { hasText: text })).toBeVisible()
  await expect(field).toHaveValue('')
  await ctx.close()
})

test('iPad: hardware keyboard, then a touch (floating keyboard next): Enter adds a line again', { tag: '@webkit-desktop' }, async ({ browser }) => {
  const { ctx, page } = await ipad(browser, sizes.portrait)
  await page.goto(`/#/a/${OMP_CHAT_PANE}`)
  await expect(page.locator('.chat').getByText('Ready when you are.')).toBeVisible()
  const field = page.locator('.prompt').locator('textarea').first()
  await field.click()
  await page.keyboard.press('ArrowLeft')
  // Touch on the field (keyboard detached, floating one used): proof forgotten.
  await field.tap()
  await page.keyboard.type('after touch')
  await page.keyboard.press('Enter')
  await expect(field).toHaveValue('after touch\n')
  // Proof again, then leaving the field forgets it too.
  await field.fill('')
  await page.keyboard.press('ArrowLeft')
  await field.evaluate(el => (el as HTMLElement).blur())
  await field.focus()
  await page.keyboard.type('after blur')
  await page.keyboard.press('Enter')
  await expect(field).toHaveValue('after blur\n')
  await ctx.close()
})

test('large iPhone in landscape (932 × 430): docked list, Enter adds a line, as before', { tag: '@webkit-desktop' }, async ({ browser }) => {
  const ctx = await browser.newContext({
    viewport: { width: 932, height: 430 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1, serviceWorkers: 'block',
    baseURL: test.info().project.use.baseURL, locale: 'en-US', timezoneId: 'UTC',
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6 Mobile/15E148 Safari/604.1',
  })
  const page = await ctx.newPage()
  await page.goto(`/#/a/${OMP_CHAT_PANE}`)
  const home = page.locator('#home')
  await expect(home).toBeVisible()
  await expect(home).not.toHaveClass(/rail|drawer/)
  expect((await home.boundingBox())!.width).toBeGreaterThanOrEqual(280)
  // Buttons keep their phone-landscape size (no tablet 44 px rule).
  expect((await page.locator('.home-actions .icon-btn').first().boundingBox())!.width).toBeLessThan(44)
  const field = page.locator('.prompt').locator('textarea').first()
  await field.click()
  await page.keyboard.press('ArrowLeft')
  await page.keyboard.type('line')
  await page.keyboard.press('Enter')
  await expect(field).toHaveValue('line\n')
  await ctx.close()
})

// On-screen keyboard as iOS shows it: the visual viewport gets shorter, the
// layout viewport does not (useViewport reads visualViewport).
async function softKeyboard(page: import('@playwright/test').Page, height: number) {
  await page.evaluate((h) => {
    const vv = window.visualViewport!
    Object.defineProperty(vv, 'height', { configurable: true, get: () => h })
    Object.defineProperty(vv, 'offsetTop', { configurable: true, get: () => 0 })
    vv.dispatchEvent(new Event('resize'))
  }, height)
  await expect(page.locator('body')).toHaveClass(/\bkb\b/)
}

const minSize = async (loc: import('@playwright/test').Locator, size: number) => {
  for (const el of await loc.all()) {
    const r = (await el.boundingBox())!
    expect(Math.round(r.width), await el.evaluate(e => e.outerHTML.slice(0, 80))).toBeGreaterThanOrEqual(size)
    expect(Math.round(r.height), await el.evaluate(e => e.outerHTML.slice(0, 80))).toBeGreaterThanOrEqual(size)
  }
}

test('iPad split view: 44 px targets, wide dividers, key bar in the active terminal cell', { tag: '@webkit-desktop' }, async ({ browser }) => {
  const { ctx, page } = await ipad(browser, sizes.portrait)
  await page.goto(`/#/t/${SPLIT_TAB}`)
  const cells = page.locator('.cell-view')
  await expect(cells).toHaveCount(2)
  await minSize(page.locator('.cell-view .agent-actions .icon-btn'), 44)
  for (const g of await page.locator('.cell-grip').all()) expect((await g.boundingBox())!.height).toBeGreaterThanOrEqual(44)
  const divider = page.locator('.split .divider.right').first()
  expect((await divider.boundingBox())!.width).toBeGreaterThanOrEqual(24)
  // The chat cell is active: no key bar anywhere.
  await expect(page.locator('.cell-view .keybar')).toHaveCount(0)
  // Activate the shell cell (terminal): its key bar shows, keys at finger size.
  await cells.nth(1).locator('.agent-title').tap()
  await expect(cells.nth(1)).toHaveClass(/active/)
  const bar = cells.nth(1).locator('.keybar')
  await expect(bar).toBeVisible()
  expect((await bar.locator('button').first().boundingBox())!.height).toBeGreaterThanOrEqual(44)
  // Esc comes first and is not pushed out of the cell by centering.
  const esc = (await bar.locator('button').first().boundingBox())!
  expect(esc.x).toBeGreaterThanOrEqual((await cells.nth(1).boundingBox())!.x)
  await expect(cells.nth(0).locator('.keybar')).toHaveCount(0)
  await ctx.close()
})

test('iPad: the keyboard shortens the window, the layout and 44 px targets stay', { tag: '@webkit-desktop' }, async ({ browser }) => {
  // The window as the keyboard leaves it, on the iPad's screen. (Resizing the
  // page in Playwright would resize the emulated screen too, which iOS never does.)
  const shortened = (viewport: { width: number, height: number }, screen: { width: number, height: number }) => browser.newContext({
    viewport, screen, isMobile: true, hasTouch: true, userAgent: IPAD_UA, deviceScaleFactor: 1,
    serviceWorkers: 'block', baseURL: test.info().project.use.baseURL, locale: 'en-US', timezoneId: 'UTC',
  })
  // iPad mini in portrait: 744 wide, shorter than 700 px with the keyboard.
  let ctx = await shortened({ width: 744, height: 600 }, sizes.mini)
  let page = await ctx.newPage()
  await page.goto(`/#/a/${CLAUDE_PANE}`)
  await expect(page.locator('#home')).toHaveClass(/rail/)
  await expect(page.locator('#btnBack')).toBeHidden()
  await minSize(page.locator('.home-rail .icon-btn'), 44)
  await ctx.close()
  // Landscape: buttons keep 44 px, the list stays docked.
  ctx = await shortened({ width: 1180, height: 420 }, sizes.portrait)
  page = await ctx.newPage()
  await page.goto(`/#/a/${CLAUDE_PANE}`)
  await expect(page.locator('#agent')).toBeVisible()
  await expect(page.locator('#home')).not.toHaveClass(/rail|drawer/)
  await minSize(page.locator('.home-actions .icon-btn'), 44)
  await ctx.close()
})

test('iPad split view with the on-screen keyboard: the active cell field and windows stay above it', { tag: '@webkit-desktop' }, async ({ browser }) => {
  const { ctx, page } = await ipad(browser, sizes.landscape)
  await page.goto(`/#/t/${SPLIT_TAB}`)
  const field = page.locator('.cell-view.active .prompt textarea').first()
  await expect(field).toBeVisible()
  const visible = 420
  await softKeyboard(page, visible)
  const view = (await page.locator('#tabview').boundingBox())!
  expect(Math.round(view.y)).toBe(0)
  expect(Math.round(view.height)).toBe(visible)
  const composer = (await page.locator('.cell-view.active .composer').boundingBox())!
  expect(composer.y + composer.height).toBeLessThanOrEqual(visible + 1)
  expect(composer.y).toBeGreaterThan(visible / 2)
  // A window (New agent) fits in the visible area too.
  await page.locator('.fab').tap()
  const sheet = page.locator('.hw-sheet').first()
  await expect(sheet).toBeVisible()
  await page.waitForTimeout(300)
  const box = (await sheet.boundingBox())!
  expect(box.y).toBeGreaterThanOrEqual(0)
  expect(box.y + box.height).toBeLessThanOrEqual(visible + 1)
  await ctx.close()
})
