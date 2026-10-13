import { expect, test } from '@playwright/test'
import { OMP_CHAT_PANE, OMP_IMAGE_PANE } from './scenario.mjs'

test('persistent drafts release the DOM of unmounted conversations after GC', async ({ page, context, browserName }) => {
  test.skip(browserName !== 'chromium', 'Controlled garbage collection requires Chromium CDP')
  const cdp = await context.newCDPSession(page)
  for (const pane of [OMP_CHAT_PANE, OMP_IMAGE_PANE]) {
    await page.goto(`/#/a/${pane}`)
    await expect(page.locator('.chat-list .msg-ai').first()).toBeVisible()
    await page.locator('.prompt textarea').fill(`Keep draft for ${pane}`)
    // Keep only weak references: neither this test nor the inspector pins the DOM.
    await page.evaluate(() => {
      const refs = (window as unknown as { releasedChatRoots?: WeakRef<Element>[] })
      ;(refs.releasedChatRoots ??= []).push(new WeakRef(document.querySelector('.chat-list')!))
    })
    await page.goto('/#/')
    await expect(page.locator('.chat-list')).toHaveCount(0)
  }
  // Allow route transitions and in-flight reads to finish; each poll is a new
  // task, so WeakRef targets are eligible again before controlled GC.
  await expect.poll(async () => {
    await cdp.send('HeapProfiler.collectGarbage')
    return page.evaluate(() => (window as unknown as { releasedChatRoots: WeakRef<Element>[] }).releasedChatRoots.every(ref => ref.deref() === undefined))
  }, { timeout: 10000, intervals: [200, 500] }).toBe(true)
  await page.goto(`/#/a/${OMP_CHAT_PANE}`)
  await expect(page.locator('.prompt textarea')).toHaveValue(`Keep draft for ${OMP_CHAT_PANE}`)
  await page.reload()
  await expect(page.locator('.prompt textarea')).toHaveValue(`Keep draft for ${OMP_CHAT_PANE}`)
  await cdp.detach()
})
