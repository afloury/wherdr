import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { expect, test } from './test'
import { OMP_IMAGE_PANE as pane, fakeHerdr } from './scenario.mjs'

const source = '<svg viewBox="0 0 160 60"><rect x="1" y="1" width="158" height="58" fill="var(--surface)" stroke="currentColor"/><text x="12" y="34" fill="var(--fg)">Ready &amp; safe</text></svg>'
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
  await reply.getByText('Show SVG source', { exact: true }).click()
  await expect(reply.locator('details pre')).toBeVisible()
  expect(await reply.locator('details pre code').textContent()).toBe(source)
  await image.click()
  await expect(page.locator('.lightbox img')).toHaveAttribute('src', /^data:image\/svg\+xml,/)
  await expect.poll(() => page.locator('.lightbox img').evaluate(img => (img as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
  await page.locator('.lightbox').getByRole('button', { name: 'Close' }).click()
  await expect(page.locator('.lightbox')).toHaveCount(0)
})
