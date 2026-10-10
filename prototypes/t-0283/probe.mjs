import { chromium, devices } from 'playwright'
import { serve } from './serve.mjs'
const server = await serve('/app/.output-demo/public', 4173)
const browser = await chromium.launch()
for (const [name, opts] of [['desktop', { viewport: { width: 1280, height: 800 } }], ['phone', { ...devices['iPhone 13'] }]]) {
  const ctx = await browser.newContext({ ...opts, locale: 'fr-FR' })
  const page = await ctx.newPage()
  page.on('pageerror', e => console.log('pageerror', e.message))
  await page.goto('http://127.0.0.1:4173/demo/#/a/w4:p1')
  page.on('console', m => console.log('console', m.text().slice(0,200))); await page.waitForTimeout(6000); console.log(page.url(), await page.locator('.q-reply').count(), await page.locator('.md-body').count())
  await page.waitForTimeout(1500)
  await page.screenshot({ path: `/app/.shots/probe-${name}.png` })
  if (name === 'desktop') {
    console.log(await page.evaluate(() => {
      const m = (document.querySelector('.q-reply') || document.body).closest('[data-hit-key]') || document.body
      return m.outerHTML + '\n----\n' + [...document.querySelectorAll('body *')].filter(e => /banner|demo/i.test(e.className?.toString?.() || '')).map(e => e.tagName + '.' + e.className).join('\n')
    }))
  }
  await ctx.close()
}
await browser.close(); server.close()
