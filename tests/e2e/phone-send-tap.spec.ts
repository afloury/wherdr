import { expect, test, type CDPSession, type Locator, type Page } from './test'
import { OMP_CHAT_PANE } from './scenario.mjs'

// Phone, keyboard open: one touch on Send sends, and the field keeps the focus
// (the keyboard stays up).
//
// On an iPhone the keyboard shrinks the visual viewport, not the layout one:
// the page becomes pannable under the finger. A touch on Send that drifts a
// little then turns into a pan and Safari never sends the click. No test
// browser opens a virtual keyboard, so the specs below recreate that state:
// - Chromium: the page is zoomed so that the visual viewport is shorter than
//   the layout one and pannable (what the keyboard does on iOS; the app sees it
//   as an open keyboard, body.kb), and a trusted touch (CDP, the browser's own
//   input pipeline) lands on Send and drifts past the browser's tap slop, which
//   starts a native pan and drops the click.
// - WebKit: Playwright can only send it a whole tap (no finger movement), so
//   no native pan. The visible area is shortened as the keyboard does (body.kb
//   on, the view fitted to it), a trusted tap lands on Send, and the browser's
//   click after it is dropped, as Safari drops it once the touch became a pan.
//   Without the fix nothing is sent; with it the touch itself sends.
// - Both: a plain trusted tap with the keyboard viewport sends once.

test.skip(({ isMobile }) => !isMobile, 'phone only')

async function openChat(page: Page, text: string) {
  await page.goto(`/#/a/${OMP_CHAT_PANE}`)
  await expect(page.locator('.chat').getByText('Ready when you are.')).toBeVisible()
  const field = page.locator('.prompt textarea').first()
  await field.click()
  await page.keyboard.type(text)
  return field
}

const viewport = (page: Page) => page.evaluate(() => ({
  kb: document.body.classList.contains('kb'),
  layoutH: innerHeight,
  visualH: visualViewport!.height,
  left: visualViewport!.offsetLeft,
  top: visualViewport!.offsetTop,
}))

// Chromium: visual viewport shorter than the layout one and pannable, moved
// over the Send button. Returns the CDP session for trusted touches.
async function keyboardViewport(page: Page): Promise<CDPSession> {
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 1.4 })
  await expect.poll(async () => (await viewport(page)).kb).toBe(true)
  // Brings the button into the visual viewport (scrollIntoView pans it).
  await page.locator('.prompt-send').evaluate(b => b.scrollIntoView({ block: 'nearest', inline: 'nearest' }))
  const v = await viewport(page)
  expect(v.visualH).toBeLessThan(v.layoutH - 120)
  return cdp
}

// A trusted touch on the button's centre that moves `dy` CSS px up before it
// lifts. CDP coordinates are those of the visual viewport, in CSS px.
async function touchDrag(page: Page, cdp: CDPSession, button: Locator, dy: number) {
  const box = await button.evaluate((b) => {
    const r = b.getBoundingClientRect()
    return { x: r.left + r.width / 2 - visualViewport!.offsetLeft, y: r.top + r.height / 2 - visualViewport!.offsetTop }
  })
  const at = (y: number) => [{ x: box.x, y, id: 1 }]
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: at(box.y) })
  for (let i = 1; i <= 4; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: at(box.y - (dy * i) / 4) })
    await page.waitForTimeout(16)
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
}

test('keyboard open: a touch on Send that drifts into a pan still sends, once, and keeps the focus', async ({ page, browserName }, testInfo) => {
  test.skip(browserName !== 'chromium', 'trusted touch moves need CDP')
  const text = `Drifting tap (${testInfo.project.name} ${Date.now()})`
  const field = await openChat(page, text)
  const cdp = await keyboardViewport(page)
  if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/${testInfo.project.name}-kb-before-tap.png` })
  const before = await viewport(page)

  // 12 CSS px at a 1.4 zoom: past Chromium's tap slop, a pan starts natively.
  await touchDrag(page, cdp, page.locator('.prompt-send'), 12)

  if (process.env.SHOTS) {
    await page.waitForTimeout(600)
    await page.screenshot({ path: `${process.env.SHOTS}/${testInfo.project.name}-kb-after-tap.png` })
  }
  await expect(page.locator('.msg-user', { hasText: text })).toHaveCount(1)
  await expect(field).toHaveValue('')
  await expect(field).toBeFocused()
  // The touch did not pan the page under the finger.
  expect(await viewport(page)).toMatchObject({ kb: true, top: before.top, left: before.left })
  await expect(page.locator('.chat').getByText('Got it.').last()).toBeVisible()
  await expect(page.locator('.msg-user:not(.msg-pending)', { hasText: text })).toHaveCount(1)
})

test('keyboard open: a touch that slides off Send does not send', async ({ page, browserName }, testInfo) => {
  test.skip(browserName !== 'chromium', 'trusted touch moves need CDP')
  const text = `Slid away (${testInfo.project.name} ${Date.now()})`
  const field = await openChat(page, text)
  const cdp = await keyboardViewport(page)

  await touchDrag(page, cdp, page.locator('.prompt-send'), 80)

  await page.waitForTimeout(500)
  await expect(page.locator('.msg-user', { hasText: text })).toHaveCount(0)
  await expect(field).toHaveValue(text)
})

// The keyboard takes the bottom of the screen: the app fits the view to the rest.
async function shortViewport(page: Page) {
  const size = page.viewportSize()!
  await page.setViewportSize({ width: size.width, height: size.height - 200 })
  await expect.poll(async () => (await viewport(page)).kb).toBe(true)
}

test('keyboard open: Send still sends when the browser drops the click after the touch, as Safari does after a pan', { tag: '@webkit-phone' }, async ({ page }, testInfo) => {
  const text = `No click (${testInfo.project.name} ${Date.now()})`
  const field = await openChat(page, text)
  await shortViewport(page)
  // Every click the browser makes of a touch on Send is stopped before the
  // button sees it. Counted, to tell which path the touch took.
  await page.evaluate(() => {
    const w = window as unknown as { droppedClicks: number }
    w.droppedClicks = 0
    window.addEventListener('click', (e) => {
      if (!e.isTrusted || !(e.target as Element | null)?.closest?.('.prompt-send')) return
      w.droppedClicks++
      e.stopImmediatePropagation()
      e.preventDefault()
    }, true)
  })
  if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/${testInfo.project.name}-noclick-before-tap.png` })

  await page.locator('.prompt-send').tap()

  if (process.env.SHOTS) {
    await page.waitForTimeout(600)
    await page.screenshot({ path: `${process.env.SHOTS}/${testInfo.project.name}-noclick-after-tap.png` })
  }
  await expect(page.locator('.msg-user', { hasText: text })).toHaveCount(1)
  await expect(field).toHaveValue('')
  await expect(field).toBeFocused()
  // The touch sent it: the browser made no click of it (touchstart cancelled).
  expect(await page.evaluate(() => (window as unknown as { droppedClicks: number }).droppedClicks)).toBe(0)
})

test('keyboard open: a tap on Send sends once and keeps the focus in the field', { tag: '@webkit-phone' }, async ({ page }, testInfo) => {
  const text = `One tap (${testInfo.project.name} ${Date.now()})`
  const field = await openChat(page, text)
  await shortViewport(page)
  await expect(field).toBeFocused()

  await page.locator('.prompt-send').tap()

  await expect(page.locator('.msg-user', { hasText: text })).toHaveCount(1)
  await expect(field).toHaveValue('')
  await expect(field).toBeFocused()
  if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/${testInfo.project.name}-kb-tap.png` })
  // Settled into the transcript, still once (no second send from a late click).
  await expect(page.locator('.chat').getByText('Got it.').last()).toBeVisible()
  await expect(page.locator('.msg-user:not(.msg-pending)', { hasText: text })).toHaveCount(1)
})
