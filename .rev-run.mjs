import { chromium } from '@playwright/test'
const out = '/tmp/hp-1000/b2ee36/WHR-283/shots'
const base = 'http://127.0.0.1:7794/'
const LAYOUT = /^(Split right|Split down|Move to…|Swap with)/
const b = await chromium.launch()
const phone = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, locale: 'en-US' }
const desk = { viewport: { width: 1440, height: 900 }, locale: 'en-US' }
for (const [name, opts] of [['phone', phone], ['desktop', desk]]) {
  const c = await b.newContext(opts)
  const p = await c.newPage()
  await p.goto(base); await p.waitForTimeout(3000)
  const ids = await p.locator('.card[data-pane]').evaluateAll(els => els.map(e => [e.getAttribute('data-pane'), e.querySelector('.card-title')?.textContent?.trim()]))
  console.log(name, 'cards', JSON.stringify(ids))
  for (const [id, title] of ids) {
    const tag = /claude/i.test(title) || ids.length && id === ids[0][0] ? title : title
    // Card right-click (desktop) / long-press equivalent context menu
    await p.goto(base); await p.waitForTimeout(2000)
    await p.locator(`.card[data-pane="${id}"]`).click({ button: 'right' }); await p.waitForTimeout(900)
    const ctx = (await p.locator('[role="menu"] [role="menuitem"]').allTextContents()).map(s => s.trim())
    console.log(name, title, 'CARD MENU', JSON.stringify(ctx), 'layout:', ctx.filter(s => LAYOUT.test(s)).length)
    const safe = title.replace(/[^a-z0-9]+/gi, '-').slice(0, 20)
    await p.screenshot({ path: `${out}/${name}-cardmenu-${safe}.png` })
    await p.keyboard.press('Escape'); await p.waitForTimeout(300)
    if (name === 'phone') {
      await p.locator(`.card[data-pane="${id}"] .card-title`).first().click(); await p.waitForTimeout(2500)
      await p.locator('.phone-identity').first().click(); await p.waitForTimeout(1200)
      const s = (await p.locator('.phone-identity-details .menu > *').allTextContents()).map(x => x.trim())
      console.log(name, title, 'PANES AND TABS', JSON.stringify(s), 'layout:', s.filter(x => LAYOUT.test(x)).length)
      await p.screenshot({ path: `${out}/phone-sheet-${safe}.png` })
    }
  }
  await c.close()
}
await b.close()
