import { expect, test, screenFixture } from './fake-core'

// Port of consecutive-questions.spec.ts to herdr-core: a Codex terminal shows one native
// question after another (terminal.read); the card follows, and an answer clicked on the
// old question is refused before any key reaches core (terminal.keys). The separate
// "refreshes without an answer" test is folded in: the card follows within 5 s here.
const fx = (name: string) => screenFixture(`${name}.txt`)

test('replaces consecutive questions and refuses an answer clicked during the stale interval', async ({ page, core }) => {
  const codex = core.codex('limits', [], { status: 'blocked', screen: fx('codex-request-increase') })
  await page.goto(codex.url)
  await expect(page.locator('.choices-list')).toContainText('Yes (y)')
  // Hold the already-clicked request, then change the terminal behind the card.
  let release!: () => void
  const held = new Promise<void>((r) => { release = r })
  await page.route('**/api/choose', async (route) => { await held; await route.continue() })
  const response = page.waitForResponse('**/api/choose')
  await page.locator('.choices-list button').filter({ hasText: 'Yes (y)' }).click()
  const start = Date.now()
  codex.setScreen(fx('codex-approaching-limits'), 'blocked')
  release()
  const stale = await response
  expect(stale.ok()).toBe(false)
  expect((await stale.json()).code).toBe('stale')
  expect(codex.keys).toEqual([])
  await expect(page.locator('.choices-list')).toContainText('Keep current model (never show again)')
  expect(Date.now() - start).toBeLessThan(5000)
  await expect(page.locator('.choices-list')).not.toContainText('Yes (y)')
  await page.unroute('**/api/choose')
  await page.locator('.choices-list button').filter({ hasText: 'Keep current model (never show again)' }).click()
  await expect.poll(() => codex.keys).toEqual(['enter'])
})
