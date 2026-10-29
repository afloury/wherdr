import { expect, test, type Page } from './test'
import { OMP_CHAT_PANE as pane, fakeHerdr } from './scenario.mjs'

const state = () => fakeHerdr('e2e.touch_scroll', { pane_id: pane }) as Promise<{ offset: number, events: { lines: number }[] }>
async function touch(page: Page, type: string, y: number, startY?: number) {
  return page.locator('#touch').evaluate((el, { type, y, startY }) => {
    const r = el.getBoundingClientRect()
    const dispatch = (kind: string, at: number) => {
      const point = { identifier: 1, target: el, clientX: r.left + r.width / 2, clientY: r.top + at }
      // WebKit forbids constructing Touch. Use real DOM listeners with the
      // same touch lists; xterm, geometry and transport remain browser code.
      const event = new Event(kind, { bubbles: true, cancelable: true })
      Object.defineProperties(event, { touches: { value: kind === 'touchend' || kind === 'touchcancel' ? [] : [point] }, changedTouches: { value: [point] } })
      el.dispatchEvent(event)
    }
    if (startY !== undefined) dispatch('touchstart', startY)
    dispatch(type, y)
    const wrap = el.closest('#termWrap')
    const screen = wrap?.querySelector('.xterm-screen') as HTMLElement
    if (screen?.style.transform) {
      const clip = wrap!.querySelector('#term')!.getBoundingClientRect()
      const grid = screen.getBoundingClientRect()
      const x = Math.max(clip.left, grid.left) + 5
      // Hit-test the actual overflow strip while prediction is active. This
      // fails if the grid paints outside #term even with an immobile frame.
      const y = grid.top < clip.top - 2 ? clip.top - 2 : grid.bottom > clip.bottom + 2 ? clip.bottom + 2 : null
      if (y !== null && document.elementsFromPoint(x, y).some(node => node === screen || screen.contains(node)))
        throw new Error('Predicted terminal grid escapes its clipping boundary')
      if (getComputedStyle(wrap!.querySelector('#term')!).overflowY !== 'hidden')
        throw new Error('Terminal prediction requires a clipped grid')
    }
    return screen?.style.transform || ''
  }, { type, y, startY })
}

async function terminal(page: Page, enabled: boolean, offset = 0) {
  await page.addInitScript(enabled => {
    localStorage.setItem('terminalRenderer', 'html')
    if (enabled) localStorage.setItem('smoothTouchScrolling', '1')
  }, enabled)
  await page.goto(`/#/a/${pane}`)
  const tabs = page.locator('.view-tabs')
  if (await tabs.count()) await tabs.getByRole('tab', { name: 'Terminal' }).click()
  else await page.locator('button[aria-label="Terminal"]').first().click()
  await expect(page.locator('#term .xterm-rows')).toContainText(`History offset ${offset}`)
}

test.beforeEach(async () => {
  await expect.poll(async () => (await fakeHerdr('e2e.pane_size', { pane_id: pane }) as { attached: boolean }).attached).toBe(false)
})

test.afterEach(async () => {
  await fakeHerdr('e2e.touch_scroll', { pane_id: pane, clear: true })
})

for (const enabled of [false, true]) {
  for (const mouse of [false, true]) {
    test(`touch beta ${enabled ? 'on' : 'off'}, ${mouse ? 'mouse app' : 'plain history'}: fixed frame and scroll contract`, { tag: '@webkit-phone' }, async ({ page, isMobile }, info) => {
      test.skip(!isMobile, 'Touch gestures use the phone viewport')
      await fakeHerdr('e2e.touch_scroll', { pane_id: pane, reset: true, mouse })
      const packets: Record<string, unknown>[] = [], incoming: Record<string, unknown>[] = []
      page.on('websocket', socket => {
        if (!socket.url().includes('/ws/term?')) return
        socket.on('framesent', ({ payload }) => { if (typeof payload === 'string') packets.push(JSON.parse(payload)) })
        socket.on('framereceived', ({ payload }) => { if (typeof payload === 'string') incoming.push(JSON.parse(payload)) })
      })
      await terminal(page, enabled)
      const bounds = await page.locator('#termWrap').boundingBox()
      if (enabled) await expect(page.locator('#termWrap')).toHaveClass(/smooth-touch/)
      // Inspect prediction in the gesture's own event turn, before a frame or
      // the expiry timer is allowed to retire it on a busy worker.
      const transform = await touch(page, 'touchmove', 90, 50)
      expect(await page.locator('#termWrap').boundingBox()).toEqual(bounds)
      if (enabled) expect(transform).toContain('translate3d')
      else expect(transform).toBe('')
      await expect.poll(async () => (await state()).offset).toBeGreaterThan(0)
      await touch(page, 'touchend', 90)
      await expect.poll(() => page.locator('.xterm-screen').evaluate(el => (el as HTMLElement).style.transform)).toBe('')
      const scrolls = packets.filter(p => p.type === 'terminal.scroll')
      expect(scrolls.length).toBeGreaterThan(0)
      if (enabled) {
        expect(scrolls.every(p => p.source === 'touch')).toBe(true)
        expect(incoming.some(p => p.type === 'scroll.ack')).toBe(true)
      }
      else {
        expect(scrolls.every(p => Object.keys(p).sort().join(',') === 'direction,lines,type')).toBe(true)
        expect(packets.some(p => p.type === 'touch.cancel')).toBe(false)
        expect(incoming.some(p => p.type === 'scroll.ack')).toBe(false)
      }
      expect((await state()).events.every(e => enabled ? e.lines === 1 : e.lines >= 1)).toBe(true)
      expect(await page.locator('#termWrap').boundingBox()).toEqual(bounds)
      await page.screenshot({ path: `.shots/terminal-touch-${enabled ? 'on' : 'off'}-${mouse ? 'mouse' : 'history'}-${info.project.name}.png` })
      // Cancelling a second gesture, then switching views, leaves no ghost grid.
      await touch(page, 'touchstart', 90)
      await touch(page, 'touchmove', 50)
      await touch(page, 'touchcancel', 50)
      if (enabled) await expect.poll(() => page.locator('.xterm-screen').evaluate(el => (el as HTMLElement).style.transform)).toBe('')
      await touch(page, 'touchstart', 60)
      await touch(page, 'touchmove', 100)
      await page.goto('/#/settings?section=terminal')
      await expect(page.locator('#termWrap')).toHaveCount(0)
      await expect(page.getByText('Smooth touch scrolling (beta)', { exact: true })).toBeVisible()
    })
  }
}

// Give each edge a fresh session so a previous momentum tail cannot mutate
// its initial fixture.
for (const edge of [0, 80]) {
  test(`beta prediction stays inside its frame at the ${edge ? 'upper' : 'lower'} edge`, { tag: '@webkit-phone' }, async ({ page, isMobile }, info) => {
    test.skip(!isMobile, 'Touch gestures use the phone viewport')
    await fakeHerdr('e2e.touch_scroll', { pane_id: pane, reset: true, mouse: edge === 80, offset: edge })
    await terminal(page, true, edge)
    const frame = await page.locator('#termWrap').boundingBox()
    const field = await page.locator('.composer').boundingBox()
    const transform = await touch(page, 'touchmove', edge ? 120 : 40, 80)
    expect(transform).toContain('translate3d')
    expect(await page.locator('#termWrap').boundingBox()).toEqual(frame)
    expect(await page.locator('.composer').boundingBox()).toEqual(field)
    await touch(page, 'touchend', edge ? 120 : 40)
    await expect.poll(() => page.locator('.xterm-screen').evaluate(el => (el as HTMLElement).style.transform)).toBe('')
    expect((await state()).offset).toBe(edge)
    expect(await page.locator('#termWrap').boundingBox()).toEqual(frame)
    expect(await page.locator('.composer').boundingBox()).toEqual(field)
    await page.screenshot({ path: `.shots/terminal-touch-edge-${edge}-${info.project.name}.png` })
  })
}

test('the beta preference is off by default and survives a reload on this device', { tag: '@webkit-phone' }, async ({ page }) => {
  await page.goto('/#/settings?section=terminal')
  const row = page.locator('.settings-toggle').filter({ hasText: 'Smooth touch scrolling (beta)' })
  const toggle = row.getByRole('switch')
  await expect(toggle).toHaveAttribute('aria-checked', 'false')
  await expect(row).toContainText('Experimental')
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-checked', 'true')
  await page.reload()
  await expect(toggle).toHaveAttribute('aria-checked', 'true')
})

for (const enabled of [false, true]) {
  test(`a normal terminal tap opens the keyboard with beta ${enabled ? 'on' : 'off'}`, { tag: '@webkit-phone' }, async ({ page, isMobile }) => {
    test.skip(!isMobile, 'Touch gestures use the phone viewport')
    await fakeHerdr('e2e.touch_scroll', { pane_id: pane, reset: true, mouse: false })
    await terminal(page, enabled)
    await expect.poll(async () => page.locator('#touch').evaluate(el => {
      const r = el.getBoundingClientRect()
      return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)?.id
    })).toBe('touch')
    await page.locator('#touch').tap()
    await expect(page.locator('.xterm-helper-textarea')).toBeFocused()
  })
}
