import { expect, test } from '@playwright/test'
import { CLAUDE_PANE, CODEX_UPDATE_PANE, OMP_CHAT_PANE } from './scenario.mjs'

const text = 'First paragraph.\n\nSecond paragraph.\n\n\nThird paragraph.'
for (const [kind, pane] of [['claude', CLAUDE_PANE], ['codex', CODEX_UPDATE_PANE], ['omp', OMP_CHAT_PANE]]) {
  test(`${kind}: blank lines remain visible in the sent bubble`, async ({ page }, info) => {
    await page.route('**/api/chat?*', route => route.fulfill({ json: {
      available: true, token: 'paragraphs', items: [{ role: 'user', text, ts: '2026-01-01T00:00:00Z' }],
    } }))
    await page.goto(`/#/a/${pane}`)
    const body = page.locator('.msg-user .msg-fold').first()
    await expect(body).toHaveText(text)
    const spacing = await body.evaluate((el, text) => {
      const top = (offset: number) => {
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
        let node = walker.nextNode()!
        while (offset >= node.textContent!.length) {
          offset -= node.textContent!.length
          node = walker.nextNode()!
        }
        const range = document.createRange()
        range.setStart(node, offset)
        range.setEnd(node, offset + 1)
        return range.getBoundingClientRect().top
      }
      return { raw: el.textContent, line: parseFloat(getComputedStyle(el).lineHeight),
        second: top(text.indexOf('Second')) - top(text.indexOf('\n') - 1),
        third: top(text.indexOf('Third')) - top(text.indexOf('\n', text.indexOf('Second')) - 1) }
    }, text)
    expect(spacing.raw).toBe(text)
    expect(spacing.second).toBeCloseTo(spacing.line * 2, 0)
    expect(spacing.third).toBeCloseTo(spacing.line * 3, 0)
    if (process.env.SHOTS && kind === 'claude') await page.screenshot({ path: `${process.env.SHOTS}/${info.project.name}-paragraphs.png` })
  })
}
