// t-0283 mock-ups (throwaway): screenshots of every variant on the demo build.
// Run in the Playwright image: node prototypes/t-0283/shoot.mjs [only…]
import { mkdirSync, readFileSync } from 'node:fs'
import { chromium } from 'playwright'
import { serve } from './serve.mjs'

const HERE = new URL('.', import.meta.url).pathname
const OUT = '/app/.shots/t-0283'
mkdirSync(OUT, { recursive: true })
const css = readFileSync(`${HERE}proto.css`, 'utf8')
const js = readFileSync(`${HERE}proto.js`, 'utf8')
const only = process.argv.slice(2)

const DESKTOP = { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 }
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' }
const LI2 = '.msg-ai .md-body li:nth-child(2)'

// name, device, variant, state, action after the variant is applied.
const shots = []
for (const v of ['0', 'A', 'B', 'C', 'D', 'E']) {
  shots.push([`${v}-desktop-rest`, DESKTOP, v, 'rest'])
  shots.push([`${v}-desktop-hover`, DESKTOP, v, 'hover', async (page) => {
    if (v === 'C') await page.hover(`${LI2} > .p-gut`)
    else if (v === 'E') await page.hover('.p-chip >> nth=0')
    else await page.hover(LI2, { position: { x: 200, y: 12 } })
  }])
  shots.push([`${v}-phone-rest`, PHONE, v, 'rest'])
  if (v !== '0') shots.push([`${v}-phone-gesture`, PHONE, v, 'gesture', async (page) => {
    if (v === 'B') await page.tap(`${LI2} > .p-disc`)
    if (v === 'C') await page.tap(`${LI2} > .p-gut`)
  }])
}
for (const n of [1, 2, 3, 4, 5, 6]) shots.push([`R${n}`, DESKTOP, `R${n}`, 'rest', null, '.msg-ai .md-body > p:last-of-type'])
const REC = process.env.REC || 'B'
shots.push([`${REC}-desktop-light`, DESKTOP, REC, 'hover', page => page.hover(REC === 'C' ? `${LI2} > .p-gut` : LI2, REC === 'C' ? {} : { position: { x: 200, y: 12 } }), null, 'catppuccin-latte'])
shots.push([`${REC}-phone-light`, PHONE, REC, 'rest', null, null, 'catppuccin-latte'])
shots.push([`${REC}-desktop-quoted`, DESKTOP, REC, 'quoted', async (page) => {
  await page.click('.msg-ai .md-body p:last-of-type > .q-reply >> nth=0')
  await page.hover(LI2, { position: { x: 200, y: 12 } })
  await page.locator(`${LI2} > .q-reply`).dispatchEvent('click')
  await page.hover(LI2, { position: { x: 200, y: 12 } })
}])
shots.push([`${REC}-phone-quoted`, PHONE, REC, 'quoted', async (page) => {
  await page.tap('.msg-ai .md-body p:last-of-type > .q-reply >> nth=0')
}])

const server = await serve('/app/.output-demo/public', 4173)
const browser = await chromium.launch()
for (const [name, device, v, state, act, clip, theme] of shots) {
  if (only.length && !only.some(o => name.startsWith(o))) continue
  const ctx = await browser.newContext({ ...device, locale: 'fr-FR', timezoneId: 'Europe/Paris' })
  if (theme) await ctx.addInitScript((t) => { localStorage.setItem('theme', t) }, theme)
  const page = await ctx.newPage()
  page.on('pageerror', e => console.log(name, 'pageerror', e.message))
  await page.goto('http://127.0.0.1:4173/demo/#/a/w4:p1')
  await page.waitForSelector('.msg-ai .md-body .q-reply', { state: 'attached', timeout: 20000 })
  await page.addStyleTag({ content: css })
  await page.addScriptTag({ content: js })
  await page.waitForTimeout(1200)
  await page.evaluate(([a, b]) => window.__proto(a, b), [v, state])
  if (act) await act(page)
  await page.waitForTimeout(500)
  if (clip) {
    const box = await page.locator(clip).boundingBox()
    await page.screenshot({ path: `${OUT}/${name}.png`, clip: { x: box.x - 12, y: box.y - 10, width: 700, height: box.height + 20 } })
  } else await page.screenshot({ path: `${OUT}/${name}.png` })
  console.log('ok', name)
  await ctx.close()
}
await browser.close()
server.close()
