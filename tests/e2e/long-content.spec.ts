import { expect, test } from '@playwright/test'
import { LONG_END, OMP_LONG_PANE } from './scenario.mjs'

for (const width of [390, 320]) {
  test(`omp conversation with long content does not scroll horizontally at ${width} px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 })
    await page.goto(`/#/a/${OMP_LONG_PANE}`)
    const chat = page.locator('.chat')
    await expect(chat.getByText(LONG_END)).toBeVisible()
    // The wide pieces are rendered (code block, table, tool row).
    await expect(chat.locator('pre').first()).toBeVisible()
    await expect(chat.locator('table').first()).toBeAttached()

    const widths = await page.evaluate(() => {
      const doc = document.scrollingElement!
      const box = document.querySelector('.chat')!
      const code = [...box.querySelectorAll('pre')].find(p => p.textContent!.includes('const endpoints'))!
      return { doc: [doc.scrollWidth, doc.clientWidth], chat: [box.scrollWidth, box.clientWidth], code: [code.scrollWidth, code.clientWidth] }
    })
    // The code block is wider than the screen: it scrolls inside itself…
    expect(widths.code[0], 'code block scrollWidth').toBeGreaterThan(widths.code[1]!)
    // …and neither the page nor the conversation scrolls sideways.
    expect(widths.doc[0], 'page scrollWidth').toBeLessThanOrEqual(widths.doc[1]!)
    expect(widths.chat[0], 'conversation scrollWidth').toBeLessThanOrEqual(widths.chat[1]!)
  })
}
