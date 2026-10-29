// A machine bar tab showing one machine: no machine header (the tab names
// it), its quotas together at the top (Claude, then Codex), and the machine's
// actions on a right click (computer) or long press (phone) of the tab. A
// group tab keeps the headers and offers its settings.
import { expect, test, type Page } from './test'
import fs from 'node:fs/promises'

const now = Date.now()
const win = (used: number, minutes: number) => ({ used, resetsAt: now + 3600000, minutes })
const account = (key: string, label: string, five: number, week: number) =>
  ({ five: win(five, 300), week: win(week, 10080), at: now, account: key.padEnd(16, 'a'), machines: [{ key, label }] })
// Codex shared by both machines (top of the list), a Claude account each.
const quotas = {
  claude: { five: win(4, 300), week: win(43, 10080), at: now },
  codex: { five: win(20, 300), week: win(35, 10080), at: now },
  claudeAccounts: [account('', 'Server', 4, 43), account('laptop', 'Laptop', 11, 7)],
}

async function setup(page: Page, laptop: 'online' | 'offline' = 'online') {
  await expect.poll(async () => (await (await page.request.get('/api/state')).json()).ok).toBe(true)
  const base = await (await page.request.get('/api/state')).json()
  const keys = ['', 'laptop']
  const machineFor = new Map(base.workspaces.map((w: { id: string }, i: number) => [w.id, keys[i % 2]]))
  const state = { ...base,
    machines: keys.map((key, i) => ({ key, label: ['Server', 'Laptop'][i], local: !key, status: key ? laptop : 'online', error: key && laptop === 'offline' ? 'SSH unavailable' : null, session: 'default' })),
    workspaces: base.workspaces.map((w: { id: string }) => ({ ...w, machine: machineFor.get(w.id) })),
    tabs: base.tabs?.map((t: { workspace: string }) => ({ ...t, machine: machineFor.get(t.workspace) })),
    panes: base.panes.map((p: { workspace: string }) => ({ ...p, machine: machineFor.get(p.workspace) })),
  }
  await page.routeWebSocket('**/ws/events', ws => ws.send(JSON.stringify(state)))
  await page.route('**/api/quotas', route => route.fulfill({ json: quotas }))
  await page.addInitScript(() => {
    if (localStorage.getItem('tabFixture')) return
    localStorage.setItem('tabFixture', '1')
    localStorage.setItem('machineGroups', JSON.stringify([{ id: '*group:perso', name: 'Perso', machines: ['laptop', ''] }]))
  })
  await page.goto('/')
  await expect(page.locator('.machine-bar-item', { hasText: 'Laptop' })).toBeVisible()
}
// Long press with a finger on the phone, right click on a computer.
async function openTabMenu(page: Page, label: string, phone: boolean) {
  const tab = page.locator('.machine-bar-item', { hasText: label })
  if (!phone) return tab.click({ button: 'right' })
  const box = (await tab.boundingBox())!
  await tab.dispatchEvent('pointerdown', { pointerType: 'touch', clientX: box.x + 10, clientY: box.y + 10 })
  await page.waitForTimeout(600)
  await tab.dispatchEvent('pointerup', { pointerType: 'touch' })
  // The long-press guard ignores synthetic clicks for 800 ms. Let it expire
  // before the next independent tab selection; screenshots are not a timer.
  await page.waitForTimeout(850)
}
const menu = (page: Page, phone: boolean) => (phone ? page.getByRole('dialog') : page.getByRole('menu'))

test('a machine tab: no header, quotas together, actions on the tab', { tag: ['@chromium-desktop', '@webkit-phone'] }, async ({ page }, info) => {
  const phone = info.project.name.includes('phone')
  await setup(page)
  await page.evaluate(() => document.fonts.ready)
  await fs.mkdir('.shots', { recursive: true })
  await page.locator('.machine-bar-item', { hasText: 'Laptop' }).click()
  await expect(page.locator('section.machine')).toHaveCount(1)
  await page.screenshot({ path: `.shots/machine-tab-${info.project.name}.png` })

  await expect(page.locator('section.machine .machine-row')).toHaveCount(0)
  await expect(page.locator('section.machine .machine-quotas')).toHaveCount(0)
  const who = await page.locator('.scroll > .quotas .quota-who').evaluateAll(els => els.map(e => e.getAttribute('title')))
  expect(who.map(w => w?.split(' · ')[0])).toEqual(['Claude', 'Codex'])

  await openTabMenu(page, 'Laptop', phone)
  await expect(menu(page, phone)).toContainText('Herdr sessions')
  await expect(menu(page, phone)).toContainText('Open the board')
  await page.screenshot({ path: `.shots/machine-tab-menu-${info.project.name}.png` })
  await page.keyboard.press('Escape')
  await expect(menu(page, phone)).toHaveCount(0)

  // The local machine (key '') too.
  await page.locator('[data-bar-id=""]').click()
  await expect(page.locator('[data-bar-id=""]')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('section.machine')).toHaveCount(1)
  await expect(page.locator('section.machine .machine-row')).toHaveCount(0)
  const local = await page.locator('.scroll > .quotas .quota-who').evaluateAll(els => els.map(e => e.getAttribute('title')))
  expect(local.map(w => w?.split(' · ')[0])).toEqual(['Claude', 'Codex'])
  await page.screenshot({ path: `.shots/machine-tab-local-${info.project.name}.png` })

  // A group keeps the machine headers, and its menu opens its settings.
  await page.locator('.machine-bar-item', { hasText: 'Perso' }).click()
  await expect(page.locator('section.machine .machine-row')).toHaveCount(2)
  await openTabMenu(page, 'Perso', phone)
  await menu(page, phone).getByText('Group settings').click()
  await expect(page.locator('.machine-group-name input')).toHaveValue('Perso')
  await page.screenshot({ path: `.shots/machine-tab-group-settings-${info.project.name}.png` })
})

test('an offline machine tab says so at the top', async ({ page }, info) => {
  await setup(page, 'offline')
  await page.locator('.machine-bar-item', { hasText: 'Laptop' }).click()
  await expect(page.locator('.machine-tab-offline')).toContainText('Laptop is offline')
  await expect(page.locator('.machine-tab-offline')).toContainText('SSH unavailable')
  await expect(page.locator('.machine-bar-item.offline', { hasText: 'Laptop' })).toBeVisible()
  await page.screenshot({ path: `.shots/machine-tab-offline-${info.project.name}.png` })
})

test('home touch swipe changes on release and cancels short drags', async ({ page, context, browserName }) => {
  test.skip(browserName !== 'chromium', 'CDP supplies native touch input')
  await setup(page)
  const all = page.locator('[data-bar-id="*"]')
  const local = page.locator('.machine-bar-item').nth(1)
  const cdp = await context.newCDPSession(page)
  async function touch(type: string, x = 260, y = 420) {
    await cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] })
  }
  await touch('touchStart')
  await touch('touchMove', 255, 350)
  await touch('touchEnd')
  await expect(all).toHaveAttribute('aria-pressed', 'true')
  await touch('touchStart')
  await touch('touchMove', 215)
  await page.waitForTimeout(120)
  await touch('touchEnd')
  await expect(all).toHaveAttribute('aria-pressed', 'true')
  await touch('touchStart')
  await touch('touchMove', 200)
  await touch('touchMove', 100)
  await expect(all).toHaveAttribute('aria-pressed', 'true') // Trigger on release; no content follows the finger.
  await touch('touchEnd')
  await expect(local).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.home-content > .scroll[class*="-active"]')).toHaveCount(0)
  await page.screenshot({ path: '.shots/home-immediate-phone.png' })
  await touch('touchStart', 10)
  await touch('touchMove', 160)
  await touch('touchEnd')
  await expect(local).toHaveAttribute('aria-pressed', 'true')
  // At the first tab an outward swipe leaves the selection unchanged.
  await page.waitForTimeout(550)
  await all.click()
  await touch('touchStart', 100)
  await touch('touchMove', 260)
  await touch('touchEnd')
  await expect(all).toHaveAttribute('aria-pressed', 'true')
})

test('desktop steps keep tabs and New fixed and repeat without moving the pointer', async ({ browser }, info) => {
  test.setTimeout(60_000)
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false,
    recordVideo: { dir: process.env.TMPDIR || info.outputDir, size: { width: 1440, height: 900 } } })
  const page = await desktop.newPage()
  try {
    await setup(page)
    await page.evaluate(() => document.fonts.ready)
    const tabs = page.locator('.machine-bar-item'), all = tabs.nth(0), neighbor = tabs.nth(1)
    await all.click()
    await page.locator('.machine-bar').hover()
    await page.evaluate(() => { (window as any).pointerMoves = 0; window.addEventListener('pointermove', () => (window as any).pointerMoves++) })
    await page.evaluate(() => {
      const home = document.querySelector<HTMLElement>('#home')!, bar = home.querySelector('.machine-bar')!, button = home.querySelector<HTMLElement>('.fab')!
      const fixed = [home, bar, button], rects = fixed.map(e => JSON.stringify(e.getBoundingClientRect()))
      const samples = (window as any).stepSamples = [] as { fixed: boolean, visible: boolean, gap: number, fade: number }[]
      function sample() {
        const incoming = home.querySelector<HTMLElement>('.scroll[class*="-enter-active"]'), outgoing = home.querySelector<HTMLElement>('.scroll[class*="-leave-active"]')
        if (incoming && outgoing) {
          const r = button.getBoundingClientRect(), viewport = home.querySelector('.home-content')!.getBoundingClientRect()
          const tx = (e: HTMLElement) => new DOMMatrixReadOnly(getComputedStyle(e).transform).m41
          samples.push({ fixed: fixed.every((e, i) => JSON.stringify(e.getBoundingClientRect()) === rects[i]),
            visible: viewport.bottom <= r.top && document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.closest('.fab') === button,
            fade: Math.abs(Math.abs(tx(incoming)) / incoming.clientWidth + Number(getComputedStyle(incoming).opacity) - 1),
            gap: Math.abs(Math.abs(tx(incoming) - tx(outgoing)) - incoming.clientWidth) })
        }
        ;(window as any).stepFrame = requestAnimationFrame(sample)
      }
      sample()
    })
    await page.mouse.wheel(480, 0)
    await expect(neighbor).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('.home-content > .scroll[class*="-active"]')).toHaveCount(0)
    await page.mouse.wheel(480, 0)
    await expect(tabs.nth(2)).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('.home-content > .scroll[class*="-active"]')).toHaveCount(0)
    await page.mouse.wheel(-480, 0)
    await expect(neighbor).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('.home-content > .scroll[class*="-active"]')).toHaveCount(0)
    const bar = (await page.locator('.machine-bar').boundingBox())!
    await page.evaluate(({ x, y }) => document.dispatchEvent(new WheelEvent('wheel', { deltaX: 120, clientX: x, clientY: y, bubbles: true, cancelable: true })), { x: bar.x + bar.width / 2, y: bar.y + bar.height / 2 })
    await expect(tabs.nth(2)).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('.home-content > .scroll[class*="-active"]')).toHaveCount(0)
    expect(await page.evaluate(() => (window as any).pointerMoves)).toBe(0)
    const samples = await page.evaluate(() => { cancelAnimationFrame((window as any).stepFrame); return (window as any).stepSamples as { fixed: boolean, visible: boolean, gap: number, fade: number }[] })
    expect(samples.length).toBeGreaterThan(5)
    expect(samples.every(s => s.fixed && s.visible && s.gap < 1 && s.fade < .02)).toBe(true)
    await all.click() // A real click immediately after a wheel gesture stays usable.
    const box = (await page.locator('#placeholder').boundingBox())!
    const x = box.x + box.width / 2, y = 400
    await page.mouse.move(x, y)
    // Target document deliberately: browsers can latch wheel targets across DOM changes.
    async function burst(steps: number[]) {
      await page.evaluate(({ steps, x, y }) => {
        for (const deltaX of steps) document.dispatchEvent(new WheelEvent('wheel', { deltaX, clientX: x, clientY: y, bubbles: true, cancelable: true }))
      }, { steps, x, y })
    }
    await burst([18, 12, -10, -10])
    await expect(page.locator('.home-content > .scroll[class*="-active"]')).toHaveCount(0)
    await expect(all).toHaveAttribute('aria-pressed', 'true')
    await burst([40, 40])
    await all.click() // Clicking interrupts a pending wheel transition immediately.
    await expect(all).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('.home-content > .scroll[class*="-active"]')).toHaveCount(0)
    await page.waitForTimeout(180) // A distinct gesture after the explicit click.
    const moves = await page.evaluate(() => (window as any).pointerMoves)
    const pair = await page.evaluate(async ({ x, y }) => {
      const active = () => document.querySelector('.machine-bar-item.on')?.getAttribute('data-bar-id')
      const buttons = Array.from(document.querySelectorAll('.machine-bar-item')), set = Element.prototype.setAttribute
      let selectedAt = 0
      // Time the selected-tab mutation, not later list/layout work in Vue's flush.
      for (const button of buttons) button.setAttribute = function(this: Element, name, value) { set.call(this, name, value); if (name === 'aria-pressed' && String(value) === 'true') selectedAt = performance.now() }
      const packet = (deltaX: number, sourceTime?: number) => {
        const e = new WheelEvent('wheel', { deltaX, clientX: x, clientY: y, bubbles: true, cancelable: true })
        if (sourceTime !== undefined) Object.defineProperty(e, 'timeStamp', { value: sourceTime })
        document.dispatchEvent(e)
        return e.timeStamp
      }
      async function impulse(steps: number[], packetTime?: number) {
        let at = 0, sourceTime = 0
        selectedAt = 0
        for (const [i, dx] of steps.entries()) { at = performance.now(); sourceTime = packet(dx, packetTime === undefined ? undefined : packetTime + i * 16) } // These traces cross the threshold on their last packet.
        await Promise.resolve()
        return { ms: selectedAt ? selectedAt - at : Infinity, active: active(), sourceTime }
      }
      const first = await impulse([25, 25, 25])
      const tailClock = first.sourceTime + 16
      for (let i = 0; i < 100; i++) {
        packet(Math.max(.1, 20 * .94 ** i), tailClock + i * 16)
        await new Promise(resolve => setTimeout(resolve, 16))
      }
      const afterTail = active(), second = await impulse([18, 18, 20], tailClock + 1600)
      for (const button of buttons) button.setAttribute = set
      return { first, afterTail, second }
    }, { x, y }) // Source times model 60 Hz hardware packets, independent of timer/render stalls.
    expect(pair.first.active).toBe(await neighbor.getAttribute('data-bar-id'))
    expect(pair.afterTail).toBe(pair.first.active)
    expect(pair.second.active).toBe(await tabs.nth(2).getAttribute('data-bar-id'))
    expect(pair.first.ms).toBeLessThan(150)
    expect(pair.second.ms).toBeLessThan(150)
    expect(await page.evaluate(() => (window as any).pointerMoves)).toBe(moves)
    console.log(`Threshold-to-selection: ${pair.first.ms.toFixed(1)} ms, ${pair.second.ms.toFixed(1)} ms`)
    await expect(page.locator('.home-content > .scroll[class*="-active"]')).toHaveCount(0)
    await page.screenshot({ path: '.shots/home-immediate-desktop.png', scale: 'css' })
    await neighbor.click()
    await expect(page.locator('.home-content > .scroll[class*="-active"]')).toHaveCount(0)
    await page.locator('.home-content > .scroll').hover()
    await page.mouse.wheel(0, 500)
    await expect.poll(() => page.locator('.home-content > .scroll').evaluate(e => e.scrollTop)).toBeGreaterThan(0)
    await expect(neighbor).toHaveAttribute('aria-pressed', 'true')
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.waitForTimeout(180)
    await burst([-40, -40, -40])
    await expect(all).toHaveAttribute('aria-pressed', 'true')
    await expect.poll(() => page.locator('.home-content > .scroll').evaluate(e => getComputedStyle(e).transitionDuration)).toBe('0s')
    await page.locator('#placeholder').evaluate(e => e.insertAdjacentHTML('beforeend', '<div id="own-scroll" style="position:absolute;top:40px;left:40px;width:100px;overflow:auto"><div style="width:600px;height:40px"></div></div>'))
    await page.locator('#own-scroll').hover()
    await page.mouse.wheel(240, 0)
    await expect.poll(() => page.locator('#own-scroll').evaluate(e => e.scrollLeft)).toBeGreaterThan(0)
    await expect(all).toHaveAttribute('aria-pressed', 'true')
    await page.locator('#home .card').first().click()
    await expect(page).toHaveURL(/#\/[at]\//)
  }
  finally { await desktop.close(); await page.video()?.saveAs('.shots/home-immediate-desktop.webm') }
})
