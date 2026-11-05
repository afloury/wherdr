import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { expect, test } from './test'
import { OMP_IMAGE_PANE as pane, fakeHerdr } from './scenario.mjs'

const source = `<svg viewBox="0 0 360 520">
  <g font-family="sans-serif" fill="var(--fg)">
    <text x="18" y="25" font-size="18" font-weight="600">SVG rendering pipeline</text>
    <text x="18" y="49" font-size="14" fill="var(--muted)">An svg code fence in an agent reply</text>
    <g fill="none" stroke="var(--border)">
      <rect x="18" y="72" width="324" height="78" rx="8"/>
      <rect x="18" y="180" width="324" height="78" rx="8"/>
      <rect x="18" y="288" width="324" height="78" rx="8"/>
      <rect x="18" y="396" width="324" height="78" rx="8"/>
      <path d="M180 150v30m-5-6 5 6 5-6M180 258v30m-5-6 5 6 5-6M180 366v30m-5-6 5 6 5-6"/>
    </g>
    <g font-size="17" font-weight="600">
      <text x="34" y="103">markdown.ts</text>
      <text x="34" y="211">svgPreview.ts</text>
      <text x="34" y="319">ChatMarkdown.vue</text>
      <text x="34" y="427">ChatView.vue</text>
    </g>
    <g font-size="14" fill="var(--muted)">
      <text x="34" y="129">Detect the fence and build one card</text>
      <text x="34" y="237">Validate static SVG; encode an image</text>
      <text x="34" y="345">Theme and preview / source switching</text>
      <text x="34" y="453">Copy markup or open fullscreen</text>
      <text x="18" y="506">Client-side rendering. No model call.</text>
    </g>
  </g>
</svg>`
const unsafe = '<svg><foreignObject><iframe src="https://example.com"/></foreignObject></svg>'
let original = ''
let fixture = ''

test.beforeAll(async () => {
  original = (await fakeHerdr('e2e.pane_field', { pane_id: pane, field: 'session' }) as { value: string }).value
  const header = JSON.parse((await fs.readFile(original, 'utf8')).split('\n')[0]!)
  fixture = path.join(path.dirname(original), 'e2e-svg-preview.jsonl')
  const timestamp = new Date().toISOString()
  const text = `A static diagram.\n\n\`\`\`svg\n${source}\n\`\`\`\n\n\`\`\`svg\n${unsafe}\n\`\`\`\n\nEnd of the diagrams.`
  await fs.writeFile(fixture, [JSON.stringify({ ...header, id: 'e2e-svg-preview' }), JSON.stringify({ type: 'message', id: 'svg-reply', timestamp, message: { role: 'assistant', content: [{ type: 'text', text }], stopReason: 'stop' } })].join('\n') + '\n')
  await fakeHerdr('e2e.update_session', { pane_id: pane, session: fixture })
})

test.afterAll(async () => {
  if (original) await fakeHerdr('e2e.update_session', { pane_id: pane, session: original })
  if (fixture) await fs.rm(fixture, { force: true })
})

test('a fenced SVG survives the real sanitizer and policy, exposes source and opens the viewer', { tag: '@webkit-phone' }, async ({ page }) => {
  await page.goto(`/#/a/${pane}`)
  const reply = page.locator('.msg-ai .md-body').filter({ hasText: 'End of the diagrams.' })
  const image = reply.locator('img.svg-preview')
  await expect(image).toHaveCount(1)
  await expect.poll(() => image.evaluate(img => (img as HTMLImageElement).complete && (img as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
  await expect(reply.locator('svg, iframe')).toHaveCount(0)
  await expect(reply.locator('pre').nth(1)).toHaveText(unsafe)
  const toggle = reply.locator('.code-head .svg-toggle')
  await toggle.click()
  await expect(reply.locator('.svg-source').first()).toBeVisible()
  await expect(image).toBeHidden()
  expect(await reply.locator('.svg-source code').first().textContent()).toBe(source)
  await toggle.click()
  await expect(image).toBeVisible()
  await expect(reply.locator('.svg-source').first()).toBeHidden()
  await image.click()
  await expect(page.locator('.lightbox img')).toHaveAttribute('src', /^data:image\/svg\+xml,/)
  await expect.poll(() => page.locator('.lightbox img').evaluate(img => (img as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
  await page.locator('.lightbox').getByRole('button', { name: 'Close' }).click()
  await expect(page.locator('.lightbox')).toHaveCount(0)
})
