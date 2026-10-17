import { expect, test, type Browser } from '@playwright/test'
import { CLAUDE_PANE, OMP_CHAT_PANE } from './scenario.mjs'

// iPad sizes in WebKit (touch, iPadOS Safari user agent). Run once, in the
// WebKit desktop project: the contexts below set their own device.
const IPAD_UA = 'Mozilla/5.0 (iPad; CPU OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6 Mobile/15E148 Safari/604.1'
const sizes = { mini: { width: 744, height: 1133 }, portrait: { width: 820, height: 1180 }, landscape: { width: 1180, height: 820 } }

async function ipad(browser: Browser, viewport: { width: number, height: number }) {
  const ctx = await browser.newContext({
    viewport, isMobile: true, hasTouch: true, userAgent: IPAD_UA, deviceScaleFactor: 1,
    serviceWorkers: 'block', baseURL: test.info().project.use.baseURL, locale: 'en-US', timezoneId: 'UTC',
  })
  return { ctx, page: await ctx.newPage() }
}

test.beforeEach(() => {
  test.skip(test.info().project.name !== 'webkit-desktop', 'iPad contexts are created by the spec itself')
})

for (const name of ['mini', 'portrait'] as const) {
  test(`iPad ${name}: sidebar layout, list slides over the conversation`, async ({ browser }) => {
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

test('iPad landscape: list docked beside the conversation, 44 px targets', async ({ browser }) => {
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

test('iPad with a hardware keyboard: Enter sends the message', async ({ browser }) => {
  const { ctx, page } = await ipad(browser, sizes.portrait)
  await page.goto(`/#/a/${OMP_CHAT_PANE}`)
  await expect(page.locator('.chat').getByText('Ready when you are.')).toBeVisible()
  const text = `From the iPad keyboard ${Date.now()}`
  const field = page.locator('.prompt').locator('textarea').first()
  await field.click()
  await page.keyboard.type(text)
  await page.keyboard.press('Enter')
  await expect(page.locator('.msg-user', { hasText: text })).toBeVisible()
  await expect(field).toHaveValue('')
  await ctx.close()
})
