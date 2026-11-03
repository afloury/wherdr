import { expect, test, type FakeCore } from './fake-core'

// Port of long-content.spec.ts to herdr-core: a Claude Code reply with an unbroken word, a
// long URL, a wide code block and a wide table (the omp tool row of the v2 scenario has no
// Claude equivalent here).
const LONG_WORD = `Pneumono${'ultramicroscopicsilicovolcano'.repeat(12)}coniosis`
const LONG_URL = `https://example.com/acme-api/releases/${'nested-segment/'.repeat(24)}changelog.html?ref=${'abcdef0123456789'.repeat(6)}`
const LONG_END = 'End of the long build report.'
const wideCode = `const endpoints = [${Array.from({ length: 14 }, (_, i) => `'/v1/resources/${i}/sub-resources/details'`).join(', ')}]`
const table = [
  '| Endpoint | Method | Median latency | p99 latency | Error rate | Owner team | Notes |',
  '|---|---|---|---|---|---|---|',
  ...Array.from({ length: 5 }, (_, i) =>
    `| /v1/resources/${i}/sub-resources/details-with-a-long-name | GET | ${12 + i} ms | ${140 + i} ms | 0.0${i} % | platform-reliability-and-observability | cached-response-without-invalidation-${i} |`),
].join('\n')
const reply = [`The build passes. One unbroken token from the log: ${LONG_WORD}`, `Full report: ${LONG_URL}`,
  '```js\n' + wideCode + '\n```', table, LONG_END].join('\n\n')
const agent = (core: FakeCore) => core.claude('docs-site', [['user', 'Run the build and summarize the endpoints report.'], ['assistant', reply]])

for (const width of [390, 320]) {
  test(`a conversation with long content does not scroll horizontally at ${width} px`, async ({ page, core }) => {
    const claude = agent(core)
    await page.setViewportSize({ width, height: 844 })
    await page.goto(claude.url)
    const chat = page.locator('.chat')
    await expect(chat.getByText(LONG_END)).toBeVisible()
    // The wide pieces are rendered (code block, table).
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
