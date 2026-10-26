import { expect, test, type Page } from './test'
import { CLAUDE_PANE } from './scenario.mjs'

const card = (page: Page) => page.locator(`#home .card[data-pane="${CLAUDE_PANE}"]`)
// Representative tail only: 20 turns, Markdown and tool output, behind a
// reproducible 250ms transport delay. This is not an iPhone hardware benchmark.
const items = Array.from({ length: 20 }, (_, i) => [
  { role: 'user', text: `Check module ${i}.`, ts: null },
  { role: 'tool', name: 'Bash', text: `npm test -- module-${i}\n${'Passed assertion.\n'.repeat(8)}`, ts: null },
  { role: 'assistant', text: `### Module ${i}\nValidated the module.\n\n- Tests pass\n- No changes required${i === 19 ? '\n\nIntent benchmark ready.' : ''}`, ts: null },
]).flat()

async function setup(page: Page) {
  let initial = 0
  let refresh = 0
  let writes = 0
  page.on('request', request => { if (request.method() === 'POST' && /\/api\/(send|choose|keys|prompt|queued)/.test(request.url())) writes++ })
  await page.route('**/api/chat?*', async route => {
    const q = new URL(route.request().url()).searchParams
    if (q.get('pane') !== CLAUDE_PANE) return route.continue()
    expect(q.has('before')).toBe(false)
    if (q.get('since')) {
      refresh++
      expect(q.get('from')).toBe('4096')
      return route.fulfill({ json: { available: true, unchanged: true } })
    }
    initial++
    await new Promise(resolve => setTimeout(resolve, 250))
    await route.fulfill({ json: { available: true, file: 'fixture.jsonl', token: 'intent-v1', start: 4096, items } })
  })
  await page.goto('/#/')
  await expect(card(page)).toBeVisible()
  return { initial: () => initial, refresh: () => refresh, writes: () => writes }
}

async function clickToPaint(page: Page, keyboard = false) {
  return page.evaluate(({ pane, keyboard }) => new Promise<number>(resolve => {
    const el = document.querySelector<HTMLElement>(`#home .card[data-pane="${pane}"]`)!
    const start = performance.now()
    const observer = new MutationObserver(() => {
      if (!document.querySelector('.chat-list')?.textContent?.includes('Intent benchmark ready.')) return
      observer.disconnect()
      requestAnimationFrame(() => resolve(performance.now() - start))
    })
    observer.observe(document, { subtree: true, childList: true })
    if (keyboard) { el.focus(); el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) }
    else el.click()
  }), { pane: CLAUDE_PANE, keyboard })
}

test('cancelled hover, right click and long press never open or send; pointerdown deduplicates at opening', async ({ page }) => {
  const reads = await setup(page)
  await card(page).evaluate(el => {
    el.dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'mouse' }))
    el.dispatchEvent(new PointerEvent('pointerleave', { pointerType: 'mouse' }))
  })
  await page.waitForTimeout(100)
  expect(reads.initial()).toBe(0)
  await card(page).dispatchEvent('pointerdown', { pointerType: 'mouse', button: 2 })
  expect(reads.initial()).toBe(0)
  await card(page).dispatchEvent('pointerdown', { pointerType: 'touch', button: 0, clientX: 100, clientY: 100 })
  await page.waitForTimeout(750)
  await card(page).dispatchEvent('pointerup', { pointerType: 'touch' })
  expect(page.url()).toMatch(/#\/$/)
  expect(reads.writes()).toBe(0)
  // Dismiss the long-press sheet, then open with the keyboard.
  await page.keyboard.press('Escape')
  await page.waitForTimeout(1050)
  await clickToPaint(page, true)
  expect(reads.initial()).toBe(1)
  await expect.poll(reads.refresh).toBeGreaterThan(0)
  expect(reads.writes()).toBe(0)
})

test('cold versus prepared tail: reproducible click-to-frame comparison', async ({ browser }, testInfo) => {
  test.setTimeout(120_000)
  const results: { cold: number[], prepared: number[] } = { cold: [], prepared: [] }
  for (const mode of ['cold', 'prepared'] as const) {
    for (let i = 0; i < 3; i++) {
      const context = await browser.newContext({ ...testInfo.project.use, viewport: { width: 390, height: 844 } })
      const page = await context.newPage()
      try {
        const reads = await setup(page)
        if (mode === 'prepared') {
          await card(page).dispatchEvent('pointerenter', { pointerType: 'mouse' })
          await expect.poll(reads.initial).toBe(1)
          await page.waitForTimeout(350)
        }
        results[mode].push(await clickToPaint(page))
        expect(reads.initial()).toBe(1)
        await expect.poll(reads.refresh).toBeGreaterThan(mode === 'prepared' ? 0 : -1)
        if (i === 0 && mode === 'prepared') {
          await page.screenshot({ path: '.shots/chat-intent-phone.png' })
          await page.setViewportSize({ width: 1440, height: 900 })
          await page.screenshot({ path: '.shots/chat-intent-desktop.png' })
        }
      } finally { await context.close() }
    }
  }
  console.log(`CHAT_INTENT_TIMINGS ${JSON.stringify(results)}`)
  await testInfo.attach('click-to-frame.json', { body: JSON.stringify(results), contentType: 'application/json' })
  // Timings are reported, not gated: shared-runner contention is not a product failure.
  expect(results.prepared).toHaveLength(3)
})
