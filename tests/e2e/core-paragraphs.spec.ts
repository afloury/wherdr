import { expect, test } from './fake-core'

// Port of paragraphs.spec.ts to herdr-core (Claude Code and Codex terminals; omp has no
// conversation on core). The conversation reply is stubbed: only its rendering is checked.
const text = 'First paragraph.\n\nSecond paragraph.\n\n\nThird paragraph.'
for (const kind of ['claude', 'codex'] as const) {
  test(`${kind}: blank lines remain visible in the sent bubble`, async ({ page, core }) => {
    const agent = kind === 'claude' ? core.claude('paragraphs') : core.codex('paragraphs')
    await page.route('**/api/chat?*', route => route.fulfill({ json: {
      available: true, token: 'paragraphs', items: [{ role: 'user', text, ts: '2026-01-01T00:00:00Z' }],
    } }))
    await page.goto(agent.url)
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
  })
}
